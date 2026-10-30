/**
 * Periodic noise primitives. These are line-for-line twins of the GLSL in
 * `gl/shaders.ts`; keep the two in sync. "Periodic" means the function repeats
 * every `per` lattice cells, so sampling `p = uv * per` over [0,1)² tiles.
 */
import { hash2, pcg, u01 } from '../hash';

const GRAD_N = 32;
const GX = new Float64Array(GRAD_N);
const GY = new Float64Array(GRAD_N);
for (let i = 0; i < GRAD_N; i++) {
  const a = (i / GRAD_N) * Math.PI * 2;
  GX[i] = Math.cos(a);
  GY[i] = Math.sin(a);
}

export const imod = (a: number, b: number) => ((a % b) + b) % b;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function corner(ix: number, iy: number, px: number, py: number, seed: number, dx: number, dy: number) {
  const h = hash2(imod(ix, px), imod(iy, py), seed) & (GRAD_N - 1);
  return GX[h] * dx + GY[h] * dy;
}

/** Periodic gradient noise, roughly in [-1, 1]. */
export function gnoise(x: number, y: number, perX: number, perY: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = corner(ix, iy, perX, perY, seed, fx, fy);
  const b = corner(ix + 1, iy, perX, perY, seed, fx - 1, fy);
  const c = corner(ix, iy + 1, perX, perY, seed, fx, fy - 1);
  const d = corner(ix + 1, iy + 1, perX, perY, seed, fx - 1, fy - 1);
  const ux = fade(fx);
  const uy = fade(fy);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return (ab + (cd - ab) * uy) * 1.4142;
}

/** Periodic fractal Brownian motion, normalised to roughly [-1, 1]. */
export function fbm(
  x: number,
  y: number,
  perX: number,
  perY: number,
  octaves: number,
  persistence: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gnoise(x * f, y * f, perX * f, perY * f, (seed + o) >>> 0);
    norm += amp;
    amp *= persistence;
    f *= 2;
  }
  return sum / norm;
}

/** Periodic Worley noise. Writes [smooth F1, F2] into `out` (smooth-min F1 avoids creases). */
export function worley(x: number, y: number, perX: number, perY: number, seed: number, out: Float64Array) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let acc = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const nx = cx + i;
      const ny = cy + j;
      const h = hash2(imod(nx, perX), imod(ny, perY), seed);
      const dx = nx + u01(h) - x;
      const dy = ny + u01(pcg(h)) - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      acc += Math.exp(-10 * d);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out[0] = Math.max(0, -Math.log(acc) / 10);
  out[1] = f2;
}
