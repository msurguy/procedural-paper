import { createPhotoRenderer, type PhotoMeta, type Box } from '../../../../packages/paper/src/composition/photos';
export { photoLater, type PhotoMeta, type Box, type Grade, type PhotoSpec } from '../../../../packages/paper/src/composition/photos';
/**
 * Photos: bundled CC0 images (public/photos, see its README), graded and
 * finished on a canvas (bw, sepia, faded, instant film, light leaks, grain,
 * halftone, a date stamp), plus a layout solver that places a photo on a
 * note and hands the rest of the card to the text.
 *
 * Photos are always drawn into canvases, so the pickup curl (curl.ts) copies
 * them like any other layer. Makers run synchronously, so they only see the
 * manifest (sizes, crop focus, captions); pixels are drawn in `runPhotos`
 * (ink photos) and `photoSprite` (attached prints), both awaited by render.ts.
 */
import type { Rng } from './rng';

const P = (id: string, w: number, h: number, focus: [number, number], ...captions: string[]): PhotoMeta => ({ id, w, h, focus, captions });

export const PHOTOS: PhotoMeta[] = [
  P('avenue', 533, 800, [0.5, 0.6], 'the long walk home', 'tree-lined, Sunday'),
  P('beach', 634, 800, [0.5, 0.5], 'from the cliff path', 'beach day!', 'so many towels'),
  P('bike', 800, 533, [0.55, 0.5], 'new bike!!', 'the blue one', 'parked outside the studio'),
  P('bookshelf', 800, 533, [0.4, 0.5], 'the library wall', 'to read: all of it'),
  P('bread', 800, 508, [0.5, 0.5], 'first sourdough', 'bake day', 'crumb shot'),
  P('cat', 800, 533, [0.55, 0.45], 'Miso', 'studio cat', 'judging us'),
  P('coast', 800, 420, [0.45, 0.6], 'north coast', 'wind + rocks', 'cold but worth it'),
  P('coffee', 800, 566, [0.35, 0.4], 'desk, 7am', 'coffee #2', 'stripes!'),
  P('dahlia', 800, 544, [0.42, 0.5], 'the yellow one', 'garden, Aug', 'colour ref'),
  P('daisies', 800, 533, [0.35, 0.55], 'palette idea', 'pink + orange?', 'macro test'),
  P('dock', 640, 800, [0.5, 0.65], 'lake days', 'shoes off', 'the dock'),
  P('drafting', 800, 600, [0.5, 0.5], 'plans, v3', 'site visit notes', 'late night'),
  P('facade', 800, 547, [0.5, 0.55], 'our old street', 'green door', 'facade study'),
  P('fog', 600, 800, [0.5, 0.55], 'foggy morning', 'the trail', 'quiet'),
  P('jump', 800, 533, [0.5, 0.5], 'we made it!', 'summit jump', 'golden hour'),
  P('lake', 800, 533, [0.5, 0.45], 'Mt. Hood', 'lake at dusk', 'mirror'),
  P('letterpress', 800, 533, [0.5, 0.5], 'press test', 'blind deboss', 'plus pattern'),
  P('pug', 800, 533, [0.48, 0.42], 'Biscuit', 'nap time', 'blanket burrito'),
  P('reading', 800, 533, [0.4, 0.45], 'the reading nook', 'shelf goals'),
  P('skyline', 800, 533, [0.5, 0.5], 'view from the 30th', 'São Paulo', 'city grid'),
  P('sprout', 800, 533, [0.62, 0.5], 'desk plant', 'less is more', 'minimal'),
  P('street', 800, 600, [0.5, 0.55], 'downtown', 'crosswalk', 'busy Monday'),
  P('sunburst', 800, 371, [0.55, 0.45], 'last light', 'the gang', 'sunset crew'),
  P('window', 800, 533, [0.45, 0.45], 'studio window', 'plant corner', 'lamp ref'),
];

export const photoMeta = (id: string) => PHOTOS.find((p) => p.id === id) ?? PHOTOS[0];
export const aspectOf = (id: string) => {
  const m = photoMeta(id);
  return m.w / m.h;
};

/** Pick a photo, optionally by shape: 'land' (w > h * 1.15), 'port' (h > w), 'any'. */
export function pickPhoto(rng: Rng, shape: 'land' | 'port' | 'any' = 'any'): PhotoMeta {
  const pool = PHOTOS.filter((p) => (shape === 'land' ? p.w > p.h * 1.15 : shape === 'port' ? p.h > p.w : true));
  return rng.pick(pool.length ? pool : PHOTOS);
}


const photoRenderer = createPhotoRenderer(photoMeta, id => `${new URL('../', location.href).pathname}photos/${id}.webp`);
export const { runPhotos, preloadPhotos, renderPhoto, loadPhoto } = photoRenderer;
// ---------------------------------------------------------------- layout



/** A placed print: centre, size and rotation (degrees), in card px. */
export interface Placed {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export type NoteLayout = 'top' | 'hang' | 'side' | 'corner';

/** Axis-aligned bounds of a rotated print. */
export function bounds(p: Placed): Box {
  const a = (p.angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (p.w * c + p.h * s) / 2, hh = (p.w * s + p.h * c) / 2;
  return { x: p.cx - hw, y: p.cy - hh, w: hw * 2, h: hh * 2 };
}

/** A corner of a rotated print (sx, sy = -1 | 1), in card px. */
export function cornerOf(p: Placed, sx: number, sy: number): [number, number] {
  const a = (p.angle * Math.PI) / 180;
  const x = (sx * p.w) / 2, y = (sy * p.h) / 2;
  return [p.cx + x * Math.cos(a) - y * Math.sin(a), p.cy + x * Math.sin(a) + y * Math.cos(a)];
}

/**
 * Largest free rectangle of `region` above, below, left or right of `b`
 * (inset by `pad`, `gap` away from the print). Null if none is at least min.
 */
export function freeRect(region: Box, b: Box, pad: number, gap: number, min: [number, number]): Box | null {
  const L = region.x + pad, T = region.y + pad, R = region.x + region.w - pad, B = region.y + region.h - pad;
  const c: Box[] = [
    { x: L, y: T, w: R - L, h: b.y - gap - T },
    { x: L, y: b.y + b.h + gap, w: R - L, h: B - (b.y + b.h + gap) },
    { x: L, y: T, w: b.x - gap - L, h: B - T },
    { x: b.x + b.w + gap, y: T, w: R - (b.x + b.w + gap), h: B - T },
  ].filter((r) => r.w >= min[0] && r.h >= min[1]);
  if (!c.length) return null;
  return c.reduce((best, r) => (r.w * r.h > best.w * best.h ? r : best));
}

export interface NoteSpec {
  /** Print aspect (w / h, including any border). */
  aspect: number;
  layouts: NoteLayout[];
  /** Where on the card the photo + text go (default: the whole card). */
  region?: Box;
  pad?: number;
  gap?: number;
  /** Smallest acceptable text box. */
  minText?: [number, number];
}

/**
 * Place a print on a note and give the text the biggest free rectangle left.
 * Templates: `top` (across the top, text below), `hang` (poking out over the
 * top edge, held by a clip), `side` (a column, text beside it), `corner`
 * (smaller, tilted, overlapping a corner). Falls back to a smaller `top`.
 */
export function layoutNote(rng: Rng, W: number, H: number, spec: NoteSpec): { layout: NoteLayout; photo: Placed; text: Box; side: 1 | -1 } {
  const region = spec.region ?? { x: 0, y: 0, w: W, h: H };
  const pad = spec.pad ?? 16, gap = spec.gap ?? 8;
  const min = spec.minText ?? [70, 46];
  const a = spec.aspect;
  const fit = (pw: number, maxH: number) => {
    let w = pw, h = pw / a;
    if (h > maxH) (h = maxH), (w = h * a);
    return [w, h];
  };
  const order = [...spec.layouts].sort(() => rng() - 0.5);
  for (const layout of [...order, 'top' as const]) {
    const fallback = layout === 'top' && !order.includes('top');
    const rx = region.x, ry = region.y, rw = region.w, rh = region.h;
    let p: Placed;
    let side: 1 | -1 = rng.chance(0.5) ? 1 : -1;
    if (layout === 'top') {
      const [w, h] = fit((rw - pad * 2) * (fallback ? 0.6 : rng.range(0.78, 0.94)), rh * (fallback ? 0.4 : 0.56));
      p = { cx: rx + rw / 2 + rng.range(-6, 6), cy: ry + pad * 0.8 + h / 2, w, h, angle: rng.range(-3, 3) };
    } else if (layout === 'hang') {
      const [w, h] = fit(rw * rng.range(0.56, 0.72), rh * 0.55);
      const out = h * rng.range(0.2, 0.34);
      p = { cx: rx + rw / 2 + rng.range(-rw * 0.12, rw * 0.12), cy: ry + h / 2 - out, w, h, angle: rng.range(-4, 4) };
    } else if (layout === 'side') {
      const [w, h] = fit(rw * rng.range(0.4, 0.5), rh - pad * 2);
      const cx = side < 0 ? rx + pad * 0.6 + w / 2 : rx + rw - pad * 0.6 - w / 2;
      p = { cx, cy: ry + pad + h / 2 + rng.range(0, Math.max(0, (rh - pad * 2 - h) * 0.3)), w, h, angle: rng.range(-3, 3) };
    } else {
      const [w, h] = fit(rw * rng.range(0.38, 0.5), rh * 0.45);
      const sy = rng.chance(0.5) ? 1 : -1;
      const over = rng.range(0.08, 0.18);
      p = {
        cx: side < 0 ? rx + w / 2 - w * over : rx + rw - w / 2 + w * over,
        cy: sy < 0 ? ry + h / 2 - h * over : ry + rh - h / 2 + h * over,
        w,
        h,
        angle: rng.range(4, 9) * (side * sy < 0 ? -1 : 1),
      };
    }
    const text = freeRect(region, bounds(p), pad, gap, min);
    if (text) return { layout, photo: p, text, side };
  }
  // nothing fits: a small print at the top, text gets what is left
  const w = Math.min(region.w * 0.4, (region.h * 0.3) * a), h = w / a;
  const photo = { cx: region.x + region.w / 2, cy: region.y + pad + h / 2, w, h, angle: 0 };
  return { layout: 'top', photo, text: { x: region.x + pad, y: region.y + pad + h + gap, w: region.w - pad * 2, h: Math.max(20, region.h - pad * 2 - h - gap) }, side: 1 };
}
