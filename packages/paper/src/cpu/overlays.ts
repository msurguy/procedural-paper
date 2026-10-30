/**
 * Sheet-scale overlays: crumples (+ wrinkles), folds and stains. Twins of the
 * GLSL in gl/shaders.ts (crumple*, foldAxis, stains).
 *
 * Crumples follow the idea of the Paper Shaders "paper texture" (faceted
 * light-catching planes separated by sharp creases) but are built as a
 * continuous height field so they also feed the height / normal maps: random
 * heights on a jittered periodic lattice, triangulated, and linearly
 * interpolated. Every facet is a plane and every crease a triangle edge.
 */
import { hash2, pcg, u01 } from '../hash';
import type { ResolvedPaper } from '../resolve';
import { gnoise, imod } from './noise';

const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// 3x3 vertex scratch: x, y, h
const VX = new Float64Array(9);
const VY = new Float64Array(9);
const VH = new Float64Array(9);

function vertex(nx: number, ny: number, perX: number, perY: number, seed: number, k: number) {
  let h = hash2(imod(nx, perX), imod(ny, perY), seed);
  const jx = u01(h);
  h = pcg(h);
  const jy = u01(h);
  h = pcg(h);
  VX[k] = nx + 0.5 + (jx - 0.5) * 0.7;
  VY[k] = ny + 0.5 + (jy - 0.5) * 0.7;
  VH[k] = u01(h) * 2 - 1;
}

/** Height of the triangle (a, b, c) at p, or NaN when p is outside it. */
function tri(px: number, py: number, a: number, b: number, c: number): number {
  const v0x = VX[b] - VX[a], v0y = VY[b] - VY[a];
  const v1x = VX[c] - VX[a], v1y = VY[c] - VY[a];
  const v2x = px - VX[a], v2y = py - VY[a];
  const d = v0x * v1y - v1x * v0y;
  const u = (v2x * v1y - v1x * v2y) / d;
  const v = (v0x * v2y - v2x * v0y) / d;
  if (u >= -1e-5 && v >= -1e-5 && u + v <= 1 + 1e-5) return VH[a] + u * (VH[b] - VH[a]) + v * (VH[c] - VH[a]);
  return NaN;
}

/** Periodic faceted height in [-1, 1]; p in lattice units. */
export function crumple(px: number, py: number, perX: number, perY: number, seed: number): number {
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) vertex(cx - 1 + i, cy - 1 + j, perX, perY, seed, j * 3 + i);
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      const a = qy * 3 + qx; // v00
      const b = a + 1; // v10
      const c = a + 3; // v01
      const d = a + 4; // v11
      const diag = hash2(imod(cx - 1 + qx, perX), imod(cy - 1 + qy, perY), (seed + 7) >>> 0) & 1;
      let h: number;
      if (diag === 0) {
        h = tri(px, py, a, b, d);
        if (h === h) return h;
        h = tri(px, py, a, d, c);
        if (h === h) return h;
      } else {
        h = tri(px, py, a, b, c);
        if (h === h) return h;
        h = tri(px, py, b, d, c);
        if (h === h) return h;
      }
    }
  }
  return 0;
}

/** Height of the folds along one axis; writes the distance (px) to the nearest fold into dist[0]. */
function foldAxis(x: number, L: number, count: number, offset: number, seed: number, strength: number, width: number, dist: Float64Array): number {
  const s = L / count;
  const t = x / s - offset;
  const k = Math.floor(t);
  const f = t - k;
  const k0 = imod(k, count);
  const k1 = imod(k + 1, count);
  const h0 = u01(hash2(k0, 0, seed)) * 2 - 1;
  const h1 = u01(hash2(k1, 0, seed)) * 2 - 1;
  const panel = h0 + (h1 - h0) * f;
  const dn = Math.min(f, 1 - f) * s;
  const kn = f < 0.5 ? k0 : k1;
  const sgn = u01(pcg(hash2(kn, 0, seed))) < 0.5 ? -1 : 1;
  const rr = Math.max(0, 1 - dn / width);
  dist[0] = dn;
  return strength * (panel * s * 0.12 + sgn * rr * rr * width * 0.3);
}

export interface OverlaySample {
  /** Height to add. */
  dh: number;
  /** Colour multiplier applied after fibers and specks. */
  mr: number;
  mg: number;
  mb: number;
}

const D = new Float64Array(1);

export function overlaySample(r: ResolvedPaper, px: number, py: number, o: OverlaySample): OverlaySample {
  const u = px / r.width;
  const v = py / r.height;
  o.dh = 0;
  o.mr = 1;
  o.mg = 1;
  o.mb = 1;

  const cr = r.crumples;
  if (cr.amp > 0 || cr.wAmp > 0) {
    let wu = u, wv = v;
    if (cr.warp > 0) {
      const k = cr.warp / ((cr.per[0] + cr.per[1]) * 0.5);
      wu += k * gnoise(u * cr.per[0], v * cr.per[1], cr.per[0], cr.per[1], cr.warpSeed);
      wv += k * gnoise(u * cr.per[0] + 5.2, v * cr.per[1] + 1.3, cr.per[0], cr.per[1], cr.warpSeed);
    }
    if (cr.amp > 0) o.dh += cr.amp * crumple(wu * cr.per[0], wv * cr.per[1], cr.per[0], cr.per[1], cr.seed);
    if (cr.wAmp > 0) {
      const [a, b] = cr.wPer;
      o.dh += cr.wAmp * (crumple(wu * a, wv * b, a, b, (cr.seed + 1) >>> 0) + 0.5 * crumple(wu * a * 2, wv * b * 2, a * 2, b * 2, (cr.seed + 2) >>> 0));
    }
  }

  const fo = r.folds;
  if (fo.strength > 0 || fo.wear > 0) {
    let wear = 0;
    if (fo.count[0] > 0) {
      o.dh += foldAxis(px, r.width, fo.count[0], fo.offset, fo.seed, fo.strength, fo.width, D);
      wear = Math.max(wear, Math.exp(-(D[0] / 1.3) * (D[0] / 1.3)));
    }
    if (fo.count[1] > 0) {
      o.dh += foldAxis(py, r.height, fo.count[1], fo.offset, (fo.seed + 1) >>> 0, fo.strength, fo.width, D);
      wear = Math.max(wear, Math.exp(-(D[0] / 1.3) * (D[0] / 1.3)));
    }
    const m = 1 - fo.wear * 0.22 * wear;
    o.mr *= m;
    o.mg *= m;
    o.mb *= m;
  }

  const sn = r.stains;
  if (sn.density > 0 && sn.strength > 0) {
    const cx = Math.floor(px / sn.cell[0]);
    const cy = Math.floor(py / sn.cell[1]);
    let keep = 1;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const nx = cx + i;
        const ny = cy + j;
        let h = hash2(imod(nx, sn.per[0]), imod(ny, sn.per[1]), sn.seed);
        if (u01(h) >= sn.density) continue;
        h = pcg(h); const r1 = u01(h);
        h = pcg(h); const r2 = u01(h);
        h = pcg(h); const r3 = u01(h);
        h = pcg(h); const r4 = u01(h);
        h = pcg(h); const r5 = u01(h);
        h = pcg(h); const r6 = u01(h);
        const ccx = (nx + 0.2 + 0.6 * r1) * sn.cell[0];
        const ccy = (ny + 0.2 + 0.6 * r2) * sn.cell[1];
        const R = sn.size * (0.55 + 0.55 * r3);
        const dx = px - ccx, dy = py - ccy;
        const L = Math.sqrt(dx * dx + dy * dy);
        if (L > R * 1.3) continue;
        const a = Math.atan2(dy, dx);
        const e = 1 + 0.035 * Math.sin(3 * a + r4 * TAU) + 0.02 * Math.sin(7 * a + r5 * TAU);
        const q = L / (R * e);
        const inside = clamp01((1 - q) * R * e + 0.5);
        const t = (q - 0.985) / 0.03;
        const ring = Math.exp(-t * t) * (0.35 + 0.65 * smoothstep(-0.4, 0.6, Math.sin(a + r6 * TAU)));
        const alpha = clamp01(inside * (0.1 + 0.14 * q * q) + ring * sn.ring) * sn.strength;
        keep *= 1 - alpha;
        o.dh += 0.15 * ring * sn.strength;
      }
    }
    const t = 1 - keep;
    o.mr *= 1 + (sn.color[0] - 1) * t;
    o.mg *= 1 + (sn.color[1] - 1) * t;
    o.mb *= 1 + (sn.color[2] - 1) * t;
  }
  return o;
}
