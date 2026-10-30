/**
 * Per-pixel paper field (everything except fibers & specks), mirrored in GLSL.
 * Coordinates are pixel centres in absolute tile space: px ∈ [0, width).
 */
import { fbm, gnoise, imod, worley } from './noise';
import type { ResolvedPaper } from '../resolve';

const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const F = new Float64Array(2);

export interface BaseSample {
  r: number;
  g: number;
  b: number;
  height: number;
}

export function structureHeight(r: ResolvedPaper, u: number, v: number): number {
  const st = r.structure;
  const a = st.vertical ? u : v;
  const b = st.vertical ? v : u;
  const mainLen = st.vertical ? r.width : r.height;
  const crossLen = st.vertical ? r.height : r.width;
  const wpa = Math.max(1, Math.round(st.per[0] / 4));
  const wpb = Math.max(1, Math.round(st.per[1] / 4));
  const A = a * st.per[0] + st.warp * 0.6 * gnoise(a * wpa, b * wpb, wpa, wpb, st.seed);
  const B = b * st.per[1];
  const sharp = st.sharpness;
  switch (st.type) {
    case 1: {
      // corrugated flutes
      const s = 0.5 + 0.5 * Math.cos(TAU * A);
      return Math.pow(s, 1 + 5 * sharp) * 2 - 1;
    }
    case 2: {
      // laid + chain lines
      const chain = Math.pow(0.5 + 0.5 * Math.cos(TAU * B), 8 + 60 * sharp);
      return 0.6 * Math.cos(TAU * A) + 1.2 * chain - 0.1;
    }
    case 3: {
      // honeycomb: offset rows of pits
      const cellA = mainLen / st.per[0];
      const cellB = crossLen / st.per[1];
      const cm = Math.min(cellA, cellB);
      const row = Math.floor(A);
      let dmin = 9;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = row + dr;
        const off = imod(rr, 2) === 1 ? 0.5 : 0;
        const col = Math.floor(B - off);
        for (let dc = -1; dc <= 1; dc++) {
          const dy = (A - (rr + 0.5)) * cellA;
          const dx = (B - (col + dc + off + 0.5)) * cellB;
          const d = Math.sqrt(dx * dx + dy * dy) / cm;
          if (d < dmin) dmin = d;
        }
      }
      const edge = 0.45 + (0.08 - 0.45) * sharp;
      return smoothstep(0.35 - edge, 0.35 + edge, dmin) * 2 - 1;
    }
    case 4: {
      // canvas weave
      const x = Math.cos(TAU * A) * Math.cos(TAU * B);
      return Math.sign(x) * Math.pow(Math.abs(x), 1 - 0.7 * sharp);
    }
    default:
      return 0;
  }
}

/** Base albedo + height at pixel centre (px, py). */
export function baseSample(r: ResolvedPaper, px: number, py: number, out: BaseSample): BaseSample {
  const u = px / r.width;
  const v = py / r.height;

  // mottle (domain-warped low-frequency fbm) and tint field
  const mo = r.mottle;
  let mx = u * mo.per[0];
  let my = v * mo.per[1];
  if (mo.warp > 0) {
    const wx = fbm(mx, my, mo.per[0], mo.per[1], 3, 0.5, mo.warpSeed);
    const wy = fbm(mx + 5.2, my + 1.3, mo.per[0], mo.per[1], 3, 0.5, mo.warpSeed);
    mx += mo.warp * wx;
    my += mo.warp * wy;
  }
  const m = fbm(mx, my, mo.per[0], mo.per[1], mo.octaves, 0.5, mo.seed);
  const t = r.tintAmount > 0 ? fbm(u * mo.per[0], v * mo.per[1], mo.per[0], mo.per[1], mo.octaves, 0.5, mo.tintSeed) : 0;

  // grain
  const gr = r.grain;
  const g = gr.strength > 0 ? fbm(u * gr.per[0], v * gr.per[1], gr.per[0], gr.per[1], gr.octaves, gr.roughness, gr.seed) : 0;

  // cells
  const ce = r.cells;
  let hc = 0;
  if (ce.strength > 0) {
    let cx = u * ce.per[0];
    let cy = v * ce.per[1];
    if (ce.warp > 0) {
      cx += ce.warp * fbm(cx, cy, ce.per[0], ce.per[1], 2, 0.5, ce.warpSeed);
      cy += ce.warp * fbm(cx + 3.7, cy + 8.1, ce.per[0], ce.per[1], 2, 0.5, ce.warpSeed);
    }
    worley(cx, cy, ce.per[0], ce.per[1], ce.seed, F);
    const dome = 0.5 - F[0];
    const ridge = F[1] - F[0] - 0.4;
    hc = (dome + (ridge - dome) * ce.ridge) * 2;
  }

  // streaks
  const sk = r.streaks;
  const st = sk.strength > 0 ? fbm(u * sk.per[0], v * sk.per[1], sk.per[0], sk.per[1], sk.octaves, 0.5, sk.seed) : 0;

  // structure
  const hs = r.structure.strength > 0 ? structureHeight(r, u, v) : 0;

  const surface = gr.strength * g + ce.strength * hc + sk.strength * st + r.structure.strength * hs;
  out.height = mo.relief * m + surface;

  const ta = r.tintAmount * clamp01(0.5 + t);
  const tone = 1 + r.variation * 2 * m + r.grainTone * surface;
  out.r = (r.base[0] + (r.tint[0] - r.base[0]) * ta) * tone;
  out.g = (r.base[1] + (r.tint[1] - r.base[1]) * ta) * tone;
  out.b = (r.base[2] + (r.tint[2] - r.base[2]) * ta) * tone;
  return out;
}
