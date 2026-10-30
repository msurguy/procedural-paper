/**
 * Fibers and specks: discrete features scattered on a periodic jittered grid.
 * Geometry is derived purely from (wrapped cell, slot) hashes so the GPU
 * (gather over 3x3 cells per pixel) and CPU (splat each feature) agree.
 */
import { hash2, pcg, u01 } from '../hash';
import type { ResolvedPaper } from '../resolve';

const TAU = Math.PI * 2;
export const FIBER_SEGMENTS = 6;

export interface Fiber {
  /** Polyline of FIBER_SEGMENTS + 1 points (x0, y0, x1, y1, ...) in pixel space. */
  pts: Float64Array;
  halfWidth: number;
  alpha: number;
  dark: boolean;
}

export interface Speck {
  cx: number;
  cy: number;
  cos: number;
  sin: number;
  /** Major / minor radius in px. */
  ra: number;
  rb: number;
  ph1: number;
  ph2: number;
  color: number;
  alpha: number;
}

const slotHash = (wx: number, wy: number, seed: number, k: number) =>
  pcg((hash2(wx, wy, seed) + Math.imul(k, 0x9e3779b9)) >>> 0);

/**
 * Fiber in slot `k` of cell `n` (unwrapped cell index; `w` is the wrapped one).
 * Returns false if the slot is empty.
 */
export function fiberAt(r: ResolvedPaper, wx: number, wy: number, nx: number, ny: number, k: number, f: Fiber): boolean {
  const fb = r.fibers;
  let h = slotHash(wx, wy, fb.seed, k);
  if (u01(h) >= Math.min(1, Math.max(0, fb.count - k))) return false;
  h = pcg(h); const r1 = u01(h);
  h = pcg(h); const r2 = u01(h);
  h = pcg(h); const r3 = u01(h);
  h = pcg(h); const r4 = u01(h);
  h = pcg(h); const r5 = u01(h);
  h = pcg(h); const r6 = u01(h);
  h = pcg(h); const r7 = u01(h);
  h = pcg(h); const r8 = u01(h);
  h = pcg(h); const r9 = u01(h);

  const cx = (nx + r1) * fb.cell[0];
  const cy = (ny + r2) * fb.cell[1];
  const ang = r3 * TAU;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const L = fb.length * (0.4 + 0.6 * r4);
  const c1 = (r5 * 2 - 1) * fb.curl * L;
  const c2 = (r6 * 2 - 1) * fb.curl * L;
  // cubic bezier control points
  const p0x = cx - dx * L * 0.5, p0y = cy - dy * L * 0.5;
  const p3x = cx + dx * L * 0.5, p3y = cy + dy * L * 0.5;
  const p1x = p0x + (dx * L) / 3 - dy * c1, p1y = p0y + (dy * L) / 3 + dx * c1;
  const p2x = p0x + (dx * 2 * L) / 3 - dy * c2, p2y = p0y + (dy * 2 * L) / 3 + dx * c2;
  for (let i = 0; i <= FIBER_SEGMENTS; i++) {
    const t = i / FIBER_SEGMENTS;
    const s = 1 - t;
    const a = s * s * s, b = 3 * s * s * t, c = 3 * s * t * t, d = t * t * t;
    f.pts[i * 2] = a * p0x + b * p1x + c * p2x + d * p3x;
    f.pts[i * 2 + 1] = a * p0y + b * p1y + c * p2y + d * p3y;
  }
  f.dark = r7 < fb.darkRatio;
  f.halfWidth = fb.width * (0.6 + 0.8 * r8) * 0.5;
  f.alpha = fb.opacity * (0.4 + 0.6 * r9);
  return true;
}

/** Coverage (0..1, before alpha) of a fiber at pixel centre (px, py). */
export function fiberCoverage(f: Fiber, px: number, py: number): number {
  let d2 = Infinity;
  const p = f.pts;
  for (let i = 0; i < FIBER_SEGMENTS; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1];
    const bx = p[i * 2 + 2], by = p[i * 2 + 3];
    const ex = bx - ax, ey = by - ay;
    const wx = px - ax, wy = py - ay;
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey + 1e-9)));
    const qx = wx - ex * t, qy = wy - ey * t;
    const dd = qx * qx + qy * qy;
    if (dd < d2) d2 = dd;
  }
  return Math.min(1, Math.max(0, f.halfWidth + 0.5 - Math.sqrt(d2)));
}

export function speckAt(r: ResolvedPaper, wx: number, wy: number, nx: number, ny: number, k: number, s: Speck): boolean {
  const sp = r.specks;
  let h = slotHash(wx, wy, sp.seed, k);
  if (u01(h) >= Math.min(1, Math.max(0, sp.count - k))) return false;
  h = pcg(h); const r1 = u01(h);
  h = pcg(h); const r2 = u01(h);
  h = pcg(h); const r3 = u01(h);
  h = pcg(h); const r4 = u01(h);
  h = pcg(h); const r5 = u01(h);
  h = pcg(h); const r6 = u01(h);
  h = pcg(h); const r7 = u01(h);
  h = pcg(h); const r8 = u01(h);
  h = pcg(h); const r9 = u01(h);
  s.cx = (nx + r1) * sp.cell[0];
  s.cy = (ny + r2) * sp.cell[1];
  const ang = r3 * TAU;
  s.cos = Math.cos(ang);
  s.sin = Math.sin(ang);
  const rad = sp.sizeMin + (sp.sizeMax - sp.sizeMin) * r4 * r4 * r4;
  s.rb = rad;
  s.ra = rad * (1 + sp.elongation * r5);
  s.color = Math.min(2, Math.floor(r6 * 3));
  s.alpha = sp.opacity * (0.5 + 0.5 * r7);
  s.ph1 = r8 * TAU;
  s.ph2 = r9 * TAU;
  return true;
}

export function speckCoverage(s: Speck, px: number, py: number): number {
  const dx = px - s.cx, dy = py - s.cy;
  const qx = dx * s.cos + dy * s.sin;
  const qy = -dx * s.sin + dy * s.cos;
  const ex = qx / s.ra, ey = qy / s.rb;
  const ang = Math.atan2(ey, ex);
  const irr = 1 + 0.12 * Math.sin(3 * ang + s.ph1) + 0.1 * Math.sin(5 * ang + s.ph2);
  const dn = Math.sqrt(ex * ex + ey * ey) / irr;
  return Math.min(1, Math.max(0, (1 - dn) * s.rb + 0.5));
}

export function newFiber(): Fiber {
  return { pts: new Float64Array((FIBER_SEGMENTS + 1) * 2), halfWidth: 0, alpha: 0, dark: false };
}
export function newSpeck(): Speck {
  return { cx: 0, cy: 0, cos: 1, sin: 0, ra: 1, rb: 1, ph1: 0, ph2: 0, color: 0, alpha: 0 };
}
