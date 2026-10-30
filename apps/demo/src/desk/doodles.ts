/**
 * Hand-drawn sketches as SVG: every primitive is wobbled, overshoots its
 * ends, and is optionally stroked twice, like a quick pen or pencil sketch.
 */
import type { Rng } from './rng';

type Pt = [number, number];

export interface Pen {
  rng: Rng;
  /** Wobble amount (px). */
  wobble: number;
  /** Number of passes per stroke (pencil = 2). */
  passes: number;
}

const f = (n: number) => n.toFixed(1);

/** Catmull-Rom through points -> cubic Bezier path. */
function smoothPath(pts: Pt[], closed = false): string {
  if (pts.length < 2) return '';
  const p = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${f(p[1][0])} ${f(p[1][1])}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

export function line(pen: Pen, a: Pt, b: Pt): string {
  const { rng, wobble } = pen;
  let out = '';
  for (let k = 0; k < pen.passes; k++) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const o1 = rng.range(-1, 1) * wobble, o2 = rng.range(-1, 1) * wobble;
    const bow = rng.range(-1, 1) * Math.min(len * 0.03, wobble * 2);
    const ov = () => rng.range(-0.04, 0.06);
    const s = ov(), e = 1 + ov();
    const P = (t: number, off: number): Pt => [a[0] + dx * t + nx * off, a[1] + dy * t + ny * off];
    out += smoothPath([P(s, o1), P(0.5, bow), P(e, o2)]);
  }
  return out;
}

export function poly(pen: Pen, pts: Pt[], closed = false): string {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) d += line(pen, pts[i], pts[i + 1]);
  if (closed) d += line(pen, pts[pts.length - 1], pts[0]);
  return d;
}

export const rect = (pen: Pen, x: number, y: number, w: number, h: number) =>
  poly(pen, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);

/** Wobbly ellipse that overshoots its start, like a quick circle. */
export function ellipse(pen: Pen, cx: number, cy: number, rx: number, ry: number): string {
  const { rng } = pen;
  let d = '';
  for (let k = 0; k < pen.passes; k++) {
    const a0 = rng() * Math.PI * 2;
    const turns = rng.range(1.05, 1.2);
    const n = 18;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * turns * Math.PI * 2;
      const j = 1 + rng.range(-1, 1) * 0.04 + (i / n) * rng.range(-0.06, 0.06);
      pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
    }
    d += smoothPath(pts);
  }
  return d;
}

export function arrow(pen: Pen, a: Pt, b: Pt, curve = 0): string {
  const { rng } = pen;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const c: Pt = [mx - (dy / len) * curve * len, my + (dx / len) * curve * len];
  let d = smoothPath([a, c, b]);
  // head: direction from c to b
  const hx = b[0] - c[0], hy = b[1] - c[1];
  const hl = Math.hypot(hx, hy) || 1;
  const ux = hx / hl, uy = hy / hl;
  const s = Math.min(12, len * 0.25) * rng.range(0.8, 1.1);
  const spread = rng.range(0.4, 0.55);
  const h1: Pt = [b[0] - s * (ux * Math.cos(spread) - uy * Math.sin(spread)), b[1] - s * (uy * Math.cos(spread) + ux * Math.sin(spread))];
  const h2: Pt = [b[0] - s * (ux * Math.cos(-spread) - uy * Math.sin(-spread)), b[1] - s * (uy * Math.cos(-spread) + ux * Math.sin(-spread))];
  d += line(pen, h1, b) + line(pen, h2, b);
  return d;
}

/** A scribbled text line (illegible handwriting). */
export function scribble(pen: Pen, x: number, y: number, w: number, amp = 3): string {
  const { rng } = pen;
  const pts: Pt[] = [];
  let px = x;
  while (px < x + w) {
    pts.push([px, y + rng.range(-amp, amp)]);
    px += rng.range(3, 6);
  }
  return smoothPath(pts);
}

export function hatch(pen: Pen, x: number, y: number, w: number, h: number, gap = 5): string {
  let d = '';
  for (let t = -h; t < w; t += gap) {
    const a: Pt = [x + Math.max(0, t), y + Math.max(0, -t)];
    const bx = Math.min(w, t + h);
    const b: Pt = [x + bx, y + (bx - t)];
    if (b[0] - a[0] > 2) d += line({ ...pen, passes: 1 }, a, b);
  }
  return d;
}

// ---------------------------------------------------------------- sketches

export type Sketch = (pen: Pen, w: number, h: number) => { d: string; fill?: string };

const wireframe: Sketch = (pen, w, h) => {
  const { rng } = pen;
  const m = 6;
  let d = rect(pen, m, m, w - 2 * m, h - 2 * m);
  d += line(pen, [m, m + 18], [w - m, m + 18]);
  d += ellipse(pen, m + 11, m + 9, 5, 5);
  for (let i = 0; i < 3; i++) d += line(pen, [w - m - 60 + i * 18, m + 9], [w - m - 50 + i * 18, m + 9]);
  const ih = h * 0.36;
  d += rect(pen, m + 8, m + 28, w * 0.5, ih);
  d += line(pen, [m + 8, m + 28], [m + 8 + w * 0.5, m + 28 + ih]) + line(pen, [m + 8 + w * 0.5, m + 28], [m + 8, m + 28 + ih]);
  for (let i = 0; i < 4; i++) d += scribble({ ...pen }, m + 16 + w * 0.5, m + 34 + i * 10, w * 0.38 - 16 - rng() * 20, 1.2);
  const by = m + 36 + ih;
  for (let i = 0; i < 3; i++) d += rect(pen, m + 8 + i * (w - 2 * m - 16) / 3, by, (w - 2 * m - 16) / 3 - 8, h - by - m - 8);
  return { d };
};

const phone: Sketch = (pen, w, h) => {
  const pw = Math.min(w * 0.42, h * 0.5);
  const ph = pw * 1.9 > h - 12 ? h - 12 : pw * 1.9;
  const x = (w - pw) / 2 - w * 0.18, y = (h - ph) / 2;
  let d = rect(pen, x, y, pw, ph) + line(pen, [x + pw * 0.35, y + 6], [x + pw * 0.65, y + 6]);
  d += rect(pen, x + 6, y + 14, pw - 12, ph * 0.35);
  for (let i = 0; i < 4; i++) d += scribble(pen, x + 8, y + 22 + ph * 0.35 + i * 9, pw - 20, 1);
  d += arrow(pen, [x + pw + 10, y + ph * 0.3], [x + pw + w * 0.32, y + ph * 0.15], -0.2);
  d += ellipse(pen, x + pw + w * 0.38, y + ph * 0.55, w * 0.12, h * 0.14);
  return { d };
};

const flow: Sketch = (pen, w, h) => {
  const bw = w * 0.26, bh = h * 0.2;
  const boxes: Pt[] = [[w * 0.05, h * 0.12], [w * 0.62, h * 0.12], [w * 0.33, h * 0.62]];
  let d = '';
  boxes.forEach(([x, y]) => (d += rect(pen, x, y, bw, bh) + scribble(pen, x + 6, y + bh / 2, bw - 14, 1.5)));
  d += arrow(pen, [boxes[0][0] + bw + 4, boxes[0][1] + bh / 2], [boxes[1][0] - 4, boxes[1][1] + bh / 2], 0.1);
  d += arrow(pen, [boxes[1][0] + bw / 2, boxes[1][1] + bh + 4], [boxes[2][0] + bw + 4, boxes[2][1] + bh / 2], -0.25);
  d += arrow(pen, [boxes[2][0] - 4, boxes[2][1] + bh / 2], [boxes[0][0] + bw / 2, boxes[0][1] + bh + 4], -0.25);
  return { d };
};

const chart: Sketch = (pen, w, h) => {
  const { rng } = pen;
  const x0 = 12, y0 = h - 12;
  let d = arrow(pen, [x0, y0], [x0, 8]) + arrow(pen, [x0, y0], [w - 8, y0]);
  const n = rng.int(4, 6);
  const bw = (w - 40) / n;
  const tops: Pt[] = [];
  let v = rng.range(0.2, 0.4);
  for (let i = 0; i < n; i++) {
    v = Math.min(0.92, Math.max(0.12, v + rng.range(-0.1, 0.25)));
    const bh = (h - 30) * v;
    const x = x0 + 10 + i * bw;
    d += rect(pen, x, y0 - bh, bw * 0.6, bh);
    if (rng.chance(0.5)) d += hatch(pen, x, y0 - bh, bw * 0.6, bh, 5);
    tops.push([x + bw * 0.3, y0 - bh - 8]);
  }
  d += smoothPath(tops);
  return { d };
};

const bulb: Sketch = (pen, w, h) => {
  const cx = w / 2, cy = h * 0.42, r = Math.min(w, h) * 0.24;
  let d = ellipse(pen, cx, cy, r, r * 1.05);
  d += line(pen, [cx - r * 0.45, cy + r * 1.05], [cx - r * 0.4, cy + r * 1.45]) + line(pen, [cx + r * 0.45, cy + r * 1.05], [cx + r * 0.4, cy + r * 1.45]);
  for (let i = 0; i < 3; i++) d += line(pen, [cx - r * 0.42, cy + r * (1.2 + i * 0.13)], [cx + r * 0.42, cy + r * (1.2 + i * 0.13)]);
  d += poly(pen, [[cx - r * 0.25, cy + r * 0.8], [cx - r * 0.2, cy + r * 0.1], [cx, cy + r * 0.3], [cx + r * 0.2, cy + r * 0.1], [cx + r * 0.25, cy + r * 0.8]]);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (1.05 + (i / 6) * 0.9);
    d += line(pen, [cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3], [cx + Math.cos(a) * r * 1.65, cy + Math.sin(a) * r * 1.65]);
  }
  return { d };
};

const landscape: Sketch = (pen, w, h) => {
  const m = 8;
  let d = rect(pen, m, m, w - 2 * m, h - 2 * m);
  d += poly(pen, [[m, h * 0.75], [w * 0.3, h * 0.35], [w * 0.48, h * 0.6], [w * 0.65, h * 0.42], [w - m, h * 0.78]]);
  d += ellipse(pen, w * 0.75, h * 0.25, 10, 10);
  d += scribble(pen, m + 4, h * 0.86, w * 0.6, 2);
  return { d };
};

const cube: Sketch = (pen, w, h) => {
  const s = Math.min(w, h) * 0.3, cx = w * 0.45, cy = h * 0.55;
  const a: Pt[] = [[cx, cy - s], [cx + s * 0.87, cy - s * 0.5], [cx, cy], [cx - s * 0.87, cy - s * 0.5]];
  const b = a.map(([x, y]) => [x, y + s] as Pt);
  let d = poly(pen, a, true) + line(pen, b[1], b[2]) + line(pen, b[2], b[3]);
  d += line(pen, a[1], b[1]) + line(pen, a[2], b[2]) + line(pen, a[3], b[3]);
  d += hatch(pen, cx + 2, cy - s * 0.5 + 6, s * 0.8, s * 0.9, 6);
  d += arrow(pen, [w * 0.9, h * 0.12], [cx + s, cy - s * 0.7], 0.3);
  return { d };
};

const stars: Sketch = (pen, w, h) => {
  const { rng } = pen;
  let d = '';
  for (let k = 0; k < 3; k++) {
    const cx = rng.range(w * 0.2, w * 0.8), cy = rng.range(h * 0.25, h * 0.75), r = rng.range(10, 24);
    const pts: Pt[] = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * ((Math.PI * 4) / 5);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    d += poly(pen, pts, true);
  }
  // spiral
  const sp: Pt[] = [];
  const sx = w * 0.18, sy = h * 0.8;
  for (let i = 0; i < 40; i++) sp.push([sx + Math.cos(i * 0.45) * i * 0.45, sy + Math.sin(i * 0.45) * i * 0.45]);
  d += smoothPath(sp);
  return { d };
};

const smiley: Sketch = (pen, w, h) => {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.32;
  let d = ellipse(pen, cx, cy, r, r);
  d += ellipse(pen, cx - r * 0.35, cy - r * 0.2, 2, 3) + ellipse(pen, cx + r * 0.35, cy - r * 0.2, 2, 3);
  const m: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (0.15 + 0.7 * (i / 8));
    m.push([cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.5]);
  }
  d += smoothPath(m);
  return { d };
};

export const SKETCHES: Record<string, Sketch> = { wireframe, phone, flow, chart, bulb, landscape, cube, stars, smiley };

export function sketchSVG(rng: Rng, w: number, h: number, opts: { ink: string; width: number; pencil?: boolean; name?: string }): string {
  const names = Object.keys(SKETCHES);
  const name = opts.name ?? rng.pick(names);
  const pen: Pen = { rng, wobble: opts.pencil ? 1.4 : 1.0, passes: opts.pencil ? 2 : 1 };
  const { d } = SKETCHES[name](pen, w, h);
  const filter = opts.pencil ? 'url(#f-pencil)' : 'url(#f-ink)';
  return `<svg class="sketch" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="filter:${filter}"><path d="${d}" fill="none" stroke="${opts.ink}" stroke-width="${opts.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opts.pencil ? 0.75 : 0.9}"/></svg>`;
}

/** Organic blob outline for watercolor swatches and stains. */
export function blobPath(rng: Rng, cx: number, cy: number, r: number, irregular = 0.18, n = 12): string {
  const pts: Pt[] = [];
  const ph = rng() * 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + irregular * (Math.sin(a * 2 + ph) * 0.5 + rng.range(-1, 1) * 0.6);
    pts.push([cx + Math.cos(a) * r * k * 1.15, cy + Math.sin(a) * r * k * 0.9]);
  }
  return smoothPath(pts, true) + 'Z';
}
