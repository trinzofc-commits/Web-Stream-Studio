/**
 * StreamCompositor
 * Renders all scene sources onto a hidden HTML5 canvas at the configured
 * resolution and aspect ratio, and exposes a MediaStream via captureStream().
 */

type Source = {
  id: number;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
  visible: boolean;
  sortOrder: number;
  settings?: Record<string, any> | null;
};

export class StreamCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly fps = 30;
  private sources: Source[] = [];

  // Resource caches
  private imageCache = new Map<string, HTMLImageElement>();
  private videoCache = new Map<number, HTMLVideoElement>(); // key: source.id
  private cameraCache = new Map<string, HTMLVideoElement>(); // key: deviceId
  private cameraStreams = new Map<string, MediaStream>();
  private browserCache = new Map<number, {
    container: HTMLDivElement;
    iframe: HTMLIFrameElement;
    snapshot: ImageBitmap | null;
    url: string;
    capturing: boolean;
    lastCapture: number;
  }>(); // key: source.id

  // ── Audio mixing ────────────────────────────────────────────────────────────
  // All audio sources are routed through a single AudioContext into one
  // MediaStreamAudioDestinationNode.  The resulting MediaStream is exposed via
  // getAudioStream() so useCanvasStream can capture and send it to the server.
  private audioCtx: AudioContext | null = null;
  private audioDestination: MediaStreamAudioDestinationNode | null = null;
  // key: source.id — HTMLAudioElement for 'audio'/'audioPlaylist' sources
  private audioElementCache = new Map<number, HTMLAudioElement>();
  // Tracks which source IDs have already been wired into the AudioContext
  private audioConnected = new Set<number>();

  constructor(width = 1280, height = 720) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
  }

  /** Update the source list and preload/prepare media assets */
  updateSources(sources: Source[]) {
    this.sources = sources;

    for (const src of sources) {
      if (!src.visible) continue;
      const s = src.settings ?? {};

      // Preload static images
      if (['image', 'logo', 'watermark'].includes(src.type) && s.url) {
        this.preloadImage(s.url);
      }

      // Preload QR codes
      if (src.type === 'qrcode' && s.data) {
        const qrUrl = this.qrUrl(s.data, s.fgColor, s.bgColor);
        this.preloadImage(qrUrl);
      }

      // Slideshow images
      if (src.type === 'slideshow' && Array.isArray(s.urls)) {
        for (const u of s.urls) if (u) this.preloadImage(u);
      }

      // Audio-only sources — play and wire into AudioContext mix
      if ((src.type === 'audio' || src.type === 'audioPlaylist') && !this.audioConnected.has(src.id)) {
        const url = s.url ?? (Array.isArray(s.urls) ? s.urls[0] : null);
        if (url) {
          const el = document.createElement('audio');
          el.src = url;
          el.loop = s.loop !== false;
          el.preload = 'auto';
          el.play().catch(() => {});
          this.audioElementCache.set(src.id, el);

          const { ctx, dest } = this.ensureAudioCtx();
          const node = ctx.createMediaElementSource(el);
          const gain = ctx.createGain();
          gain.gain.value = typeof s.volume === 'number' ? s.volume : 1.0;
          node.connect(gain);
          gain.connect(dest);
          this.audioConnected.add(src.id);
        }
      }

      // Video file sources
      if (src.type === 'video' && s.url && !this.videoCache.has(src.id)) {
        const vid = document.createElement('video');
        vid.src = s.url;
        vid.autoplay = true;
        vid.loop = s.loop !== false;
        vid.muted = true;
        vid.playsInline = true;
        vid.play().catch(() => {});
        this.videoCache.set(src.id, vid);
      }

      // VideoPlaylist — play first URL
      if (src.type === 'videoPlaylist' && !this.videoCache.has(src.id)) {
        const urls: string[] = s.urls ?? [];
        if (urls.length > 0) {
          const vid = document.createElement('video');
          vid.src = urls[0];
          vid.autoplay = true;
          vid.loop = s.loop !== false;
          vid.muted = true;
          vid.playsInline = true;
          vid.play().catch(() => {});
          this.videoCache.set(src.id, vid);
        }
      }

      // Browser source — hidden iframe + async snapshot capture
      if (src.type === 'browser' && s.url) {
        const existing = this.browserCache.get(src.id);
        // Recreate if URL changed
        if (existing && existing.url !== s.url) {
          existing.iframe.src = 'about:blank';
          existing.container.remove();
          existing.snapshot?.close();
          this.browserCache.delete(src.id);
        }
        if (!this.browserCache.has(src.id)) {
          const frameW = s.frameWidth ?? 1280;
          const frameH = s.frameHeight ?? 720;
          const container = document.createElement('div');
          container.style.cssText = `position:fixed;left:-${frameW + 100}px;top:0;width:${frameW}px;height:${frameH}px;overflow:hidden;pointer-events:none;z-index:-9999;`;
          const iframe = document.createElement('iframe');
          iframe.src = s.url;
          iframe.style.cssText = `width:${frameW}px;height:${frameH}px;border:none;`;
          iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
          container.appendChild(iframe);
          document.body.appendChild(container);
          const entry = { container, iframe, snapshot: null as ImageBitmap | null, url: s.url as string, capturing: false, lastCapture: 0 };
          this.browserCache.set(src.id, entry);
          iframe.onload = () => this.captureBrowserSnapshot(src.id, s.css as string | undefined);
        }
      }

      // Camera
      if (src.type === 'camera') {
        const key = s.deviceId ?? 'default';
        if (!this.cameraCache.has(key)) {
          const vid = document.createElement('video');
          vid.autoplay = true;
          vid.muted = true;
          vid.playsInline = true;
          const constraints: MediaStreamConstraints =
            key !== 'default'
              ? { video: { deviceId: { exact: key } }, audio: false }
              : { video: true, audio: false };
          navigator.mediaDevices
            .getUserMedia(constraints)
            .then((stream) => {
              this.cameraStreams.set(key, stream);
              vid.srcObject = stream;
              vid.play().catch(() => {});
            })
            .catch(() => {});
          this.cameraCache.set(key, vid);
        }
      }
    }
  }

  /** Start the render loop using setInterval so it runs at full rate even
   *  when the tab is backgrounded or the canvas is off-screen.
   *  requestAnimationFrame throttles to ~1fps in background tabs, which causes
   *  FFmpeg to receive almost no real frames and duplicate them → choppy stream. */
  start() {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => this.drawFrame(), 1000 / this.fps);
  }

  /** Stop rendering and release all resources */
  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    for (const stream of this.cameraStreams.values()) {
      stream.getTracks().forEach((t) => t.stop());
    }
    this.cameraStreams.clear();
    this.cameraCache.clear();
    for (const vid of this.videoCache.values()) {
      vid.pause();
      vid.src = '';
    }
    this.videoCache.clear();
    for (const entry of this.browserCache.values()) {
      entry.iframe.src = 'about:blank';
      entry.container.remove();
      entry.snapshot?.close();
    }
    this.browserCache.clear();
    // Audio cleanup
    for (const el of this.audioElementCache.values()) {
      el.pause();
      el.src = '';
    }
    this.audioElementCache.clear();
    this.audioConnected.clear();
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
      this.audioDestination = null;
    }
  }

  // ── Audio API ───────────────────────────────────────────────────────────────

  /** Returns the mixed audio stream, or null if no audio sources are loaded. */
  getAudioStream(): MediaStream | null {
    return this.audioDestination?.stream ?? null;
  }

  /**
   * Resume the AudioContext after a user gesture (required by browser autoplay
   * policy). Call this inside a click/tap handler, e.g. when the user clicks
   * "Start Stream".
   */
  resumeAudioContext(): void {
    this.audioCtx?.resume().catch(() => {});
  }

  /** Lazy-create the shared AudioContext + destination node. */
  private ensureAudioCtx(): { ctx: AudioContext; dest: MediaStreamAudioDestinationNode } {
    if (!this.audioCtx || !this.audioDestination) {
      this.audioCtx = new AudioContext({ sampleRate: 44100 });
      this.audioDestination = this.audioCtx.createMediaStreamDestination();
    }
    return { ctx: this.audioCtx, dest: this.audioDestination };
  }

  // ─── Browser source snapshot capture ─────────────────────────────────────

  /** Async: render iframe content into an ImageBitmap via SVG foreignObject.
   *  Works for same-origin pages; silently skips cross-origin (security). */
  private captureBrowserSnapshot(sourceId: number, css?: string) {
    const entry = this.browserCache.get(sourceId);
    if (!entry || entry.capturing) return;

    let doc: Document | null = null;
    try {
      doc = entry.iframe.contentDocument;
    } catch {
      // cross-origin — cannot access document
      return;
    }
    if (!doc || !doc.documentElement) return;

    entry.capturing = true;
    entry.lastCapture = Date.now();

    try {
      // Inject custom CSS if provided
      if (css) {
        const styleId = '__compositor_css__';
        let styleEl = doc.getElementById(styleId) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = doc.createElement('style');
          styleEl.id = styleId;
          doc.head?.appendChild(styleEl);
        }
        styleEl.textContent = css;
      }

      const w = entry.iframe.offsetWidth || 1280;
      const h = entry.iframe.offsetHeight || 720;

      // Serialize DOM to SVG foreignObject (same-origin only)
      const serializer = new XMLSerializer();
      const htmlStr = serializer.serializeToString(doc.documentElement);
      const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<foreignObject width="100%" height="100%">` +
        `<html xmlns="http://www.w3.org/1999/xhtml">${htmlStr}</html>` +
        `</foreignObject></svg>`;

      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        createImageBitmap(img)
          .then((bitmap) => {
            const cur = this.browserCache.get(sourceId);
            if (cur) {
              cur.snapshot?.close();
              cur.snapshot = bitmap;
            }
          })
          .catch(() => {})
          .finally(() => {
            URL.revokeObjectURL(url);
            const cur = this.browserCache.get(sourceId);
            if (cur) cur.capturing = false;
          });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const cur = this.browserCache.get(sourceId);
        if (cur) cur.capturing = false;
      };
      img.src = url;
    } catch {
      entry.capturing = false;
    }
  }

  /** Get a live MediaStream from the canvas */
  captureStream(fps = 30): MediaStream {
    return (this.canvas as any).captureStream(fps);
  }

  // ─── Private rendering ───────────────────────────────────────────────────

  /** Draw image mimicking CSS objectFit: contain — preserves aspect ratio,
   *  letter/pillar-boxes to fit inside the destination rectangle. */
  private drawContain(
    img: HTMLImageElement | HTMLVideoElement,
    x: number, y: number, w: number, h: number,
  ) {
    const naturalW = img instanceof HTMLImageElement ? img.naturalWidth  : img.videoWidth;
    const naturalH = img instanceof HTMLImageElement ? img.naturalHeight : img.videoHeight;
    if (!naturalW || !naturalH) return;

    const imgAspect = naturalW / naturalH;
    const boxAspect = w / h;
    let dw: number, dh: number, dx: number, dy: number;

    if (imgAspect > boxAspect) {
      // wider than box → fit by width, add top/bottom bars
      dw = w;
      dh = w / imgAspect;
      dx = x;
      dy = y + (h - dh) / 2;
    } else {
      // taller than box → fit by height, add left/right bars
      dh = h;
      dw = h * imgAspect;
      dx = x + (w - dw) / 2;
      dy = y;
    }
    this.ctx.drawImage(img, dx, dy, dw, dh);
  }

  /** Draw image mimicking CSS objectFit: cover — fills the destination
   *  rectangle by cropping the image edges. */
  private drawCover(
    img: HTMLImageElement | HTMLVideoElement,
    x: number, y: number, w: number, h: number,
  ) {
    const naturalW = img instanceof HTMLImageElement ? img.naturalWidth  : img.videoWidth;
    const naturalH = img instanceof HTMLImageElement ? img.naturalHeight : img.videoHeight;
    if (!naturalW || !naturalH) return;

    const imgAspect = naturalW / naturalH;
    const boxAspect = w / h;
    let sx: number, sy: number, sw: number, sh: number;

    if (imgAspect > boxAspect) {
      // image wider → crop left and right
      sh = naturalH;
      sw = naturalH * boxAspect;
      sx = (naturalW - sw) / 2;
      sy = 0;
    } else {
      // image taller → crop top and bottom
      sw = naturalW;
      sh = naturalW / boxAspect;
      sx = 0;
      sy = (naturalH - sh) / 2;
    }
    this.ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  private drawFrame() {
    const { ctx } = this;
    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const visible = [...this.sources]
      .filter((s) => s.visible)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    for (const source of visible) {
      this.drawSource(source);
    }
  }

  private drawSource(source: Source) {
    const { ctx } = this;
    const s = source.settings ?? {};
    const { x = 0, y = 0, width = 1280, height = 720, opacity = 100, rotation = 0 } = source;

    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, opacity / 100));

    if (rotation) {
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-(x + width / 2), -(y + height / 2));
    }

    try {
      switch (source.type) {
        case 'color': {
          ctx.fillStyle = s.color ?? '#1a1a2e';
          ctx.fillRect(x, y, width, height);
          break;
        }

        case 'text': {
          if (s.bgColor && s.bgColor !== 'transparent') {
            ctx.fillStyle = s.bgColor;
            ctx.fillRect(x, y, width, height);
          }
          const fontSize = s.fontSize ?? 48;
          ctx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${fontSize}px ${s.fontFamily ?? 'sans-serif'}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (s.outline) {
            ctx.strokeStyle = s.outlineColor ?? '#000000';
            ctx.lineWidth = Math.max(2, fontSize / 10);
            ctx.strokeText(s.text ?? 'Text', x + width / 2, y + height / 2);
          }
          ctx.fillStyle = s.color ?? '#ffffff';
          ctx.fillText(s.text ?? 'Text', x + width / 2, y + height / 2);
          break;
        }

        case 'image':
        case 'logo':
        case 'watermark': {
          const img = s.url ? this.imageCache.get(s.url) : null;
          if (img?.complete && img.naturalWidth > 0) {
            // For logo/watermark, apply settings.opacity on top of globalAlpha
            // (mirrors the CSS opacity on the sub-div in CanvasPreview)
            if ((source.type === 'logo' || source.type === 'watermark') && s.opacity != null && s.opacity < 1) {
              const prevAlpha = ctx.globalAlpha;
              ctx.globalAlpha = prevAlpha * (s.opacity as number);
              this.drawContain(img, x, y, width, height);
              ctx.globalAlpha = prevAlpha;
            } else {
              const fit = source.type === 'image' ? (s.fit ?? 'contain') : 'contain';
              if (fit === 'cover') this.drawCover(img, x, y, width, height);
              else if (fit === 'fill') ctx.drawImage(img, x, y, width, height);
              else this.drawContain(img, x, y, width, height);
            }

          } else {
            this.placeholder(ctx, x, y, width, height, '#3b4a6b');
          }
          break;
        }

        case 'camera': {
          // CSS preview uses objectFit: cover for camera (fills box, crops edges)
          const key = s.deviceId ?? 'default';
          const vid = this.cameraCache.get(key);
          if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
            if (s.mirror) {
              ctx.save();
              ctx.translate(x + width, y);
              ctx.scale(-1, 1);
              // draw mirrored: cover into (0,0,width,height) then translate back
              this.drawCover(vid, 0, 0, width, height);
              ctx.restore();
            } else {
              this.drawCover(vid, x, y, width, height);
            }
          } else {
            this.placeholder(ctx, x, y, width, height, '#1a3a2a');
          }
          break;
        }

        case 'video':
        case 'videoPlaylist': {
          // CSS preview uses objectFit: contain for video
          const vid = this.videoCache.get(source.id);
          if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
            this.drawContain(vid, x, y, width, height);
          } else {
            this.placeholder(ctx, x, y, width, height, '#2a1e3a');
          }
          break;
        }

        case 'clock': {
          ctx.fillStyle = '#000000';
          ctx.fillRect(x, y, width, height);
          const clockText = this.formatClock(new Date(), s.format ?? 'HH:mm:ss');
          ctx.fillStyle = s.color ?? '#00e5ff';
          ctx.font = `bold ${s.fontSize ?? 80}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(clockText, x + width / 2, y + height / 2);
          break;
        }

        case 'countdown': {
          const diff = s.targetDate
            ? Math.max(0, Math.floor((new Date(s.targetDate).getTime() - Date.now()) / 1000))
            : 0;
          const cdText = diff <= 0 ? (s.endMessage ?? '00:00:00') : this.formatDuration(diff);
          ctx.fillStyle = '#000000';
          ctx.fillRect(x, y, width, height);
          ctx.fillStyle = s.color ?? '#ff4444';
          ctx.font = `bold ${s.fontSize ?? 80}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(cdText, x + width / 2, y + height / 2);
          break;
        }

        case 'qrcode': {
          if (s.data) {
            const url = this.qrUrl(s.data, s.fgColor, s.bgColor);
            const img = this.imageCache.get(url);
            if (img?.complete && img.naturalWidth > 0) {
              ctx.fillStyle = s.bgColor ?? '#ffffff';
              ctx.fillRect(x, y, width, height);
              const size = Math.min(width, height) * 0.85;
              ctx.drawImage(img, x + (width - size) / 2, y + (height - size) / 2, size, size);
            } else {
              this.placeholder(ctx, x, y, width, height, '#ffffff');
            }
          } else {
            this.placeholder(ctx, x, y, width, height, '#ffffff');
          }
          break;
        }

        case 'slideshow': {
          const urls: string[] = s.urls ?? [];
          if (urls.length > 0) {
            const idx = Math.floor(Date.now() / ((s.interval ?? 5) * 1000)) % urls.length;
            const url = urls[idx];
            if (url) this.preloadImage(url);
            const img = url ? this.imageCache.get(url) : null;
            if (img?.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, x, y, width, height);
            } else {
              this.placeholder(ctx, x, y, width, height, '#1a1e2a');
            }
          } else {
            this.placeholder(ctx, x, y, width, height, '#1a1e2a');
          }
          break;
        }

        case 'browser': {
          const entry = this.browserCache.get(source.id);
          if (entry?.snapshot) {
            ctx.drawImage(entry.snapshot, x, y, width, height);
          } else {
            this.placeholder(ctx, x, y, width, height, '#1e3a5f');
          }
          // Trigger async refresh every ~100 ms (10 fps for browser content)
          if (entry && !entry.capturing && Date.now() - entry.lastCapture > 100) {
            this.captureBrowserSnapshot(source.id, source.settings?.css as string | undefined);
          }
          break;
        }

        case 'audio':
        case 'audioPlaylist':
          // Audio-only sources — nothing to draw on the canvas.
          // Their HTMLAudioElement is managed separately in audioElementCache.
          break;

        default:
          this.placeholder(ctx, x, y, width, height, '#222222');
      }
    } catch {
      // ignore draw errors per source
    }

    ctx.restore();
  }

  private placeholder(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    color: string,
  ) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  private preloadImage(url: string) {
    if (this.imageCache.has(url)) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    this.imageCache.set(url, img);
  }

  /** Expose raw canvas so callers can capture JPEG frames without MediaRecorder */
  getCanvas(): HTMLCanvasElement { return this.canvas; }

  private qrUrl(data: string, fg?: string, bg?: string) {
    const fgHex = (fg ?? '#000000').replace('#', '');
    const bgHex = (bg ?? '#ffffff').replace('#', '');
    return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(data)}&color=${fgHex}&bgcolor=${bgHex}`;
  }

  private formatClock(date: Date, fmt: string): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const h24 = date.getHours();
    const h12 = h24 % 12 || 12;
    const m = date.getMinutes();
    const s = date.getSeconds();
    const ampm = h24 < 12 ? 'AM' : 'PM';
    return fmt
      .replace('HH', pad(h24))
      .replace('H', String(h24))
      .replace('mm', pad(m))
      .replace('m', String(m))
      .replace('ss', pad(s))
      .replace('s', String(s))
      .replace('h', String(h12))
      .replace('A', ampm);
  }

  private formatDuration(secs: number): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
  }
}
