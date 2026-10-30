import type { OutputMode } from '../params';
import type { ResolvedPaper } from '../resolve';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Turn albedo + height (+ central-difference slopes hx, hy) into an output pixel.
 * Mirrors COMPOSE_FS in gl/shaders.ts. Writes rgb (0..1) into `out`.
 */
export function composePixel(
  r: ResolvedPaper,
  mode: OutputMode,
  ar: number,
  ag: number,
  ab: number,
  h: number,
  hx: number,
  hy: number,
  out: Float64Array,
) {
  const k = r.light.depth;
  let nx = -hx * k;
  let ny = -hy * k;
  let nz = 1;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx /= len;
  ny /= len;
  nz /= len;
  const o = r.output;

  if (mode === 'normal') {
    out[0] = nx * 0.5 + 0.5;
    out[1] = (o.flipY ? ny : -ny) * 0.5 + 0.5;
    out[2] = nz * 0.5 + 0.5;
    return;
  }
  if (mode === 'height') {
    const v = clamp01(0.5 + 0.5 * h * r.heightNorm);
    out[0] = out[1] = out[2] = v;
    return;
  }

  const L = r.light.dir;
  let shade = (nx * L[0] + ny * L[1] + nz * L[2]) / L[2];
  shade = shade < 0 ? 0 : shade > 3 ? 3 : shade;
  const lit = mode !== 'albedo';
  let cr = lit ? ar * shade : ar;
  let cg = lit ? ag * shade : ag;
  let cb = lit ? ab * shade : ab;

  if (mode === 'overlay') {
    const lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
    const v = clamp01((lum - r.baseLum) * 0.5 * o.contrast + 0.5 + o.brightness);
    out[0] = out[1] = out[2] = v;
    return;
  }
  out[0] = clamp01((cr - 0.5) * o.contrast + 0.5 + o.brightness);
  out[1] = clamp01((cg - 0.5) * o.contrast + 0.5 + o.brightness);
  out[2] = clamp01((cb - 0.5) * o.contrast + 0.5 + o.brightness);
}
