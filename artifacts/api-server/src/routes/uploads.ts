import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, mediaAssetsTable } from "@workspace/db";
import { serialize } from "../lib/serialize";
import { logger } from "../lib/logger";
import {
  ListUploadsQueryParams,
  DeleteUploadParams,
  ListUploadsResponse,
} from "@workspace/api-zod";

/**
 * Max long-side pixels for uploaded images.
 * Images larger than this are downscaled server-side before storage.
 * 1280 px = 720p landscape (1280×720) which matches the stream encode resolution.
 * Reduces browser memory, canvas compositing load, and WebSocket bandwidth.
 */
const IMAGE_MAX_LONG_SIDE = 1280;

const router: IRouter = Router();

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
      "video/mp4", "video/mov", "video/quicktime", "video/webm", "video/avi",
      "audio/mp3", "audio/mpeg", "audio/wav", "audio/ogg", "audio/aac",
      "application/pdf",
    ];
    cb(null, allowed.includes(file.mimetype) || file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/"));
  },
});

function getAssetType(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "overlay";
}

router.get("/uploads", async (req, res): Promise<void> => {
  const query = ListUploadsQueryParams.safeParse(req.query);
  let assets = await db.select().from(mediaAssetsTable).orderBy(mediaAssetsTable.createdAt);
  if (query.success && query.data.type) {
    assets = assets.filter((a) => a.type === query.data.type);
  }
  res.json(ListUploadsResponse.parse(serialize(assets)));
});

router.post("/uploads", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const assetType = getAssetType(req.file.mimetype);
  let finalPath = req.file.path;
  let finalSize = req.file.size;

  // ── Auto-downscale images to max 1280px on long side ──────────────────────
  // Compositor draws images onto a 720p canvas anyway — storing a 4K PNG only
  // wastes browser RAM and slows canvas compositing. We resize in-place so the
  // URL stays the same and no extra storage is needed.
  if (req.file.mimetype.startsWith("image/") && req.file.mimetype !== "image/gif") {
    try {
      const meta = await sharp(finalPath).metadata();
      const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);

      if (longSide > IMAGE_MAX_LONG_SIDE) {
        const isLandscape = (meta.width ?? 0) >= (meta.height ?? 0);
        const resizeOpts = isLandscape
          ? { width: IMAGE_MAX_LONG_SIDE }
          : { height: IMAGE_MAX_LONG_SIDE };

        const tmpPath = `${finalPath}.resizing`;
        await sharp(finalPath)
          .resize(resizeOpts)
          .jpeg({ quality: 85, progressive: true })
          .toFile(tmpPath);

        fs.renameSync(tmpPath, finalPath);
        finalSize = fs.statSync(finalPath).size;
        logger.info(
          { original: req.file.size, resized: finalSize, longSide },
          "Image downscaled on upload",
        );
      }
    } catch (err) {
      // Non-fatal: keep original file if resize fails
      logger.warn({ err, file: req.file.filename }, "Image resize failed — keeping original");
    }
  }

  const url = `/api/uploads/files/${req.file.filename}`;
  const [asset] = await db
    .insert(mediaAssetsTable)
    .values({
      filename: req.file.originalname,
      url,
      type: assetType,
      mimeType: req.file.mimetype,
      sizeBytes: finalSize,
    })
    .returning();
  res.status(201).json(serialize(asset));
});

// Serve uploaded files
router.get("/uploads/files/:filename", (req, res): void => {
  const filename = path.basename(req.params.filename as string);
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.sendFile(filePath);
});

router.delete("/uploads/:id", async (req, res): Promise<void> => {
  const params = DeleteUploadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [asset] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, params.data.id));
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  // Try to delete file
  const filename = path.basename(asset.url);
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
