export interface PhotoMeta {
  id: string;
  w: number;
  h: number;
  /** Crop focus, 0..1 of the image. */
  focus: [number, number];
  captions: string[];
}

export type Grade = 'none' | 'bw' | 'sepia' | 'faded' | 'instant' | 'warm' | 'expired';

export interface PhotoSpec {
  id: string;
  grade?: Grade;
  /** 0..1 */
  vignette?: number;
  /** 0..1 */
  grain?: number;
  /** Light leak from one edge. */
  leak?: boolean;
  /** Orange LCD date stamp in the corner ("'98 7 14"). */
  stamp?: string;
  /** Colour halftone screen (newsprint, magazines). */
  halftone?: boolean;
  /** Extra crop zoom (>= 1). */
  zoom?: number;
  seed?: number;
}

export interface Box { x: number; y: number; w: number; h: number }
export const photoSpecs = new WeakMap<HTMLCanvasElement, PhotoSpec>();
export function photoLater(spec: PhotoSpec, box: Box, cls = '', style = '') {
  const c = document.createElement('canvas'); c.className = `photo ${cls}`.trim();
  c.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;${style}`;
  photoSpecs.set(c, spec); return c;
}
export function createPhotoRenderer(metadata: (id: string) => Pick<PhotoMeta, 'focus'>, url: (id: string) => string | Promise<string>, ratio = () => Math.min(2, devicePixelRatio || 1)) {
const ready = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();
const photoMeta = metadata;
async function loadPhoto(id: string): Promise<HTMLImageElement> {
  let task = pending.get(id);
  if (!task) { task = (async () => { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = await url(id); await img.decode(); ready.set(id, img); return img; })().catch(e => { pending.delete(id); throw new Error(`Unable to load photo ${id}: ${e}`); }); pending.set(id, task); }
  return task;
}
const FILTERS: Record<Grade, string> = {
  none: 'contrast(1.04) saturate(1.04)',
  bw: 'grayscale(1) contrast(1.18) brightness(1.03)',
  sepia: 'sepia(0.85) contrast(1.06) brightness(0.98) saturate(0.9)',
  faded: 'contrast(0.82) saturate(0.68) brightness(1.06)',
  instant: 'contrast(0.9) saturate(0.85) brightness(1.04)',
  warm: 'sepia(0.22) saturate(1.18) contrast(1.05)',
  expired: 'contrast(0.86) saturate(1.3) hue-rotate(-10deg) brightness(1.04)',
};

let noiseTile: HTMLCanvasElement | null = null;
function noise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  // Keep photo sampling deterministic across first use, cached images and exports.
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const d = g.createImageData(128, 128);
  let s = 12345;
  for (let i = 0; i < d.data.length; i += 4) {
    s = (s * 1103515245 + 12345) >>> 0;
    const v = 128 + (((s >>> 16) & 255) - 128) * 0.9;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return (noiseTile = c);
}

/** Cheap seeded hash so finishes vary per photo without an rng. */
const h01 = (seed: number, k: number) => {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Colour halftone: rotated dot screens per channel, blended with the original. */
function halftone(g: CanvasRenderingContext2D, W: number, H: number, k: number) {
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const period = 3.4 * k;
  const angles = [0.26, 1.31, 0.79].map((a) => [Math.cos(a), Math.sin(a)]);
  const TAU = (Math.PI * 2) / period;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const [ca, sa] = angles[c];
        const u = (x * ca - y * sa) * TAU, v = (x * sa + y * ca) * TAU;
        const screen = 0.5 + 0.25 * (Math.cos(u) + Math.cos(v));
        const val = d[i + c] / 255;
        // ink (1 - val) covers the cell where the screen is below it; soft edge for antialiasing
        const t = Math.min(1, Math.max(0, (1 - val - screen) * 3 + 0.5));
        const dot = 1 - t;
        d[i + c] = Math.round((val * 0.45 + dot * 0.55) * 255);
      }
    }
  g.putImageData(img, 0, 0);
}

/**
 * Draw a graded photo into a `w` x `h` CSS-px box at `k` device px per px.
 * Synchronous: the image must have been loaded (`loadPhoto`).
 */
function renderPhoto(spec: PhotoSpec, w: number, h: number, k: number): HTMLCanvasElement {
  const meta = photoMeta(spec.id);
  const src = ready.get(spec.id);
  if (!src) throw new Error(`Photo not loaded: ${spec.id}`);
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  // Keep photo sampling deterministic across first use, cached images and exports.
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const iw = src instanceof HTMLImageElement ? src.naturalWidth : (src as HTMLCanvasElement).width;
  const ih = src instanceof HTMLImageElement ? src.naturalHeight : (src as HTMLCanvasElement).height;
  // cover-crop around the focus point
  const scale = Math.max(W / iw, H / ih) * (spec.zoom ?? 1);
  const sw = W / scale, sh = H / scale;
  const sx = Math.min(iw - sw, Math.max(0, meta.focus[0] * iw - sw / 2));
  const sy = Math.min(ih - sh, Math.max(0, meta.focus[1] * ih - sh / 2));
  const grade = spec.grade ?? 'none';
  const seed = spec.seed ?? 1;
  g.filter = FILTERS[grade];
  g.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
  g.filter = 'none';

  const fill = (op: GlobalCompositeOperation, style: string | CanvasGradient | CanvasPattern, alpha = 1) => {
    g.globalCompositeOperation = op;
    g.globalAlpha = alpha;
    g.fillStyle = style;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  };
  // lifted blacks and colour casts
  if (grade === 'faded') fill('lighten', 'rgb(46,40,52)');
  if (grade === 'sepia') fill('lighten', 'rgb(52,40,30)');
  if (grade === 'instant') {
    fill('lighten', 'rgb(34,50,54)');
    fill('soft-light', '#ffd9a0', 0.35);
  }
  if (grade === 'expired') {
    fill('lighten', 'rgb(40,30,46)');
    fill('soft-light', h01(seed, 1) < 0.5 ? '#ff6fa0' : '#6fffb0', 0.3);
  }
  if (spec.leak) {
    const side = Math.floor(h01(seed, 2) * 4);
    const lx = side === 0 ? 0 : side === 1 ? W : W * h01(seed, 3);
    const ly = side === 2 ? 0 : side === 3 ? H : H * h01(seed, 4);
    const r = Math.max(W, H) * (0.45 + 0.3 * h01(seed, 5));
    const grad = g.createRadialGradient(lx, ly, 0, lx, ly, r);
    grad.addColorStop(0, 'rgba(255,150,60,0.85)');
    grad.addColorStop(0.35, 'rgba(255,90,40,0.4)');
    grad.addColorStop(1, 'rgba(255,60,30,0)');
    fill('screen', grad);
  }
  if (spec.halftone) halftone(g, W, H, k);
  if (spec.vignette) {
    const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${spec.vignette.toFixed(2)})`);
    fill('multiply', grad);
  }
  if (spec.grain) {
    const pat = g.createPattern(noise(), 'repeat')!;
    pat.setTransform(new DOMMatrix().translate(h01(seed, 6) * 128, h01(seed, 7) * 128).scale(k * 0.6));
    fill('overlay', pat, 0.18 * spec.grain);
  }
  if (spec.stamp) {
    const px = Math.max(9, Math.min(w, h) * 0.075) * k;
    g.font = `${px}px VT323, monospace`;
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(255,120,30,0.9)';
    g.shadowBlur = px * 0.35;
    g.fillStyle = 'rgba(255,150,60,0.95)';
    g.fillText(spec.stamp, W - px * 0.9, H - px * 0.7);
    g.shadowBlur = 0;
  }
  return c;
}


async function preloadPhotos(specs: PhotoSpec[]) {
  await Promise.all([ ...specs.map(s => loadPhoto(s.id)), ...(specs.some(s => s.stamp) ? [document.fonts.load('16px VT323')] : []) ]);
}
async function runPhotos(root: HTMLElement) {
  const nodes = [...root.querySelectorAll<HTMLCanvasElement>('canvas.photo')].filter(c => photoSpecs.has(c));
  await preloadPhotos(nodes.map(c => photoSpecs.get(c)!));
  for (const c of nodes) { const image = renderPhoto(photoSpecs.get(c)!, parseFloat(c.style.width), parseFloat(c.style.height), ratio()); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0); }
}
return { renderPhoto, preloadPhotos, runPhotos, loadPhoto, dispose() { pending.clear(); ready.clear(); noiseTile = null; } };
}
