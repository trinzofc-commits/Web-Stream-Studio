/**
 * StreamCompositor
 * Renders all scene sources onto a hidden HTML5 canvas at 1280×720
 * and exposes a MediaStream via captureStream() for live encoding.
 */

type Source = {
  id: number;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  visible: boolean;
  sortOrder: number;
  settings: Record<string, any> | null;
};

export class StreamCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private sources: Source[] = [];

  // Resource caches
  private imageCache = new Map<string, HTMLImageElement>();
  private videoCache = new Map<number, HTMLVideoElement>(); // key: source.id
  private cameraCache = new Map<string, HTMLVideoElement>(); // key: deviceId
  private cameraStreams = new Map<string, MediaStream>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
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

  /** Start the render loop */
  start() {
    const loop = () => {
      this.drawFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Stop rendering and release camera streams */
  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
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
  }

  /** Get a live MediaStream from the canvas */
  captureStream(fps = 30): MediaStream {
    return (this.canvas as any).captureStream(fps);
  }

  // ─── Private rendering ───────────────────────────────────────────────────

  private drawFrame() {
    const { ctx } = this;
    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 1280, 720);

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
            ctx.drawImage(img, x, y, width, height);
          } else {
            this.placeholder(ctx, x, y, width, height, '#3b4a6b');
          }
          break;
        }

        case 'camera': {
          const key = s.deviceId ?? 'default';
          const vid = this.cameraCache.get(key);
          if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
            if (s.mirror) {
              ctx.save();
              ctx.translate(x + width, y);
              ctx.scale(-1, 1);
              ctx.drawImage(vid, 0, 0, width, height);
              ctx.restore();
            } else {
              ctx.drawImage(vid, x, y, width, height);
            }
          } else {
            this.placeholder(ctx, x, y, width, height, '#1a3a2a');
          }
          break;
        }

        case 'video':
        case 'videoPlaylist': {
          const vid = this.videoCache.get(source.id);
          if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
            ctx.drawImage(vid, x, y, width, height);
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
