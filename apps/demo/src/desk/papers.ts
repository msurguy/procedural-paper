import { PaperRenderer, toCanvas } from 'procedural-paper';
export { paperStocks as PAPERS, stockParams as paperParams, paperBase, isDark } from 'procedural-paper';
import { stockParams as paperParams } from 'procedural-paper';

// ---------------------------------------------------------------- textures

export interface Tex {
  url: string;
  /** Tile size in CSS px. */
  size: number;
}

let renderer: PaperRenderer | null = null;
/** One shared WebGL2 renderer for tiles and sheets. */
export function getRenderer(): PaperRenderer {
  renderer ??= new PaperRenderer({ backend: 'auto' });
  return renderer;
}
const cache = new Map<string, Promise<Tex>>();
let chain: Promise<unknown> = Promise.resolve();

export const stats = { renders: 0, ms: 0 };

export let textureScale = 0.7;
export function setTextureScale(s: number) {
  if (s === textureScale) return;
  textureScale = s;
  for (const t of cache.values()) t.then((x) => URL.revokeObjectURL(x.url));
  cache.clear();
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * A seamless tile for `key`. `tile` is the CSS size; rendering happens at
 * devicePixelRatio with `scale` (and densities) adjusted so the paper looks
 * the same on any screen. Renders are serialized and yield between tiles so
 * cards appear progressively without blocking input.
 */
export function paperTexture(key: string, variant = 0, tile = 384, zoom = 1): Promise<Tex> {
  const id = `${key}|${variant}|${tile}|${zoom}|${textureScale}`;
  let t = cache.get(id);
  if (t) return t;
  t = (chain = chain.then(async () => {
    await nextFrame();
    const t0 = performance.now();
    const renderer = getRenderer();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = textureScale * zoom * dpr;
    const base = paperParams(key);
    const px = Math.round(tile * dpr);
    const res = renderer.render(
      {
        ...base,
        seed: base.seed + variant * 101,
        scale: base.scale * k,
        // physically, zooming out by `textureScale` would raise feature density by 1/t²;
        // 1/t keeps small papers from looking busy
        fibers: { ...base.fibers, density: base.fibers.density / (k * dpr) },
        specks: { ...base.specks, density: base.specks.density / (k * dpr) },
      },
      px,
      px,
      ['color'],
    );
    const canvas = toCanvas(res.maps.color!);
    const blob = await new Promise<Blob>((ok, err) => canvas.toBlob((b) => (b ? ok(b) : err(new Error('toBlob failed'))), 'image/png'));
    stats.renders++;
    stats.ms += performance.now() - t0;
    return { url: URL.createObjectURL(blob), size: tile };
  })) as Promise<Tex>;
  cache.set(id, t);
  return t;
}

export const rendererBackend = () => renderer?.backend ?? '…';
