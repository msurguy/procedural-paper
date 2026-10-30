/**
 * Pure-JS renderer. Same algorithm as the WebGL2 path, but fibers and specks
 * are splatted per feature (fast on CPU) instead of gathered per pixel.
 */
import type { OutputMode } from '../params';
import type { ResolvedPaper } from '../resolve';
import { baseSample, type BaseSample } from './field';
import { imod } from './noise';
import { fiberAt, fiberCoverage, FIBER_SEGMENTS, newFiber, newSpeck, speckAt, speckCoverage } from './strands';
import { composePixel } from './compose';
import { overlaySample, type OverlaySample } from './overlays';

export interface Fields {
  width: number;
  height: number;
  /** Unlit albedo, rgb interleaved. */
  albedo: Float32Array;
  height_: Float32Array;
}

export function computeFields(r: ResolvedPaper): Fields {
  const W = r.width;
  const H = r.height;
  const N = W * H;
  const albedo = new Float32Array(N * 3);
  const height = new Float32Array(N);
  const s: BaseSample = { r: 0, g: 0, b: 0, height: 0 };
  const o: OverlaySample = { dh: 0, mr: 1, mg: 1, mb: 1 };
  const overlays = r.crumples.amp > 0 || r.crumples.wAmp > 0 || r.folds.strength > 0 || r.folds.wear > 0 || r.stains.density > 0;
  // colour multipliers from folds / stains, applied after fibers and specks
  const mul = overlays ? new Float32Array(N * 3) : null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      baseSample(r, x + 0.5, y + 0.5, s);
      const i = y * W + x;
      albedo[i * 3] = s.r;
      albedo[i * 3 + 1] = s.g;
      albedo[i * 3 + 2] = s.b;
      height[i] = s.height;
      if (mul) {
        overlaySample(r, x + 0.5, y + 0.5, o);
        height[i] += o.dh;
        mul[i * 3] = o.mr;
        mul[i * 3 + 1] = o.mg;
        mul[i * 3 + 2] = o.mb;
      }
    }
  }

  // ---- fibers: transmittance products (order independent) ----
  const fb = r.fibers;
  if (fb.count > 0 && fb.opacity > 0) {
    const darkT = new Float32Array(N).fill(1);
    const lightT = new Float32Array(N).fill(1);
    const f = newFiber();
    const slots = Math.ceil(fb.count);
    for (let cy = 0; cy < fb.per[1]; cy++) {
      for (let cx = 0; cx < fb.per[0]; cx++) {
        for (let k = 0; k < slots; k++) {
          if (!fiberAt(r, cx, cy, cx, cy, k, f)) continue;
          let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
          for (let i = 0; i <= FIBER_SEGMENTS; i++) {
            const px = f.pts[i * 2], py = f.pts[i * 2 + 1];
            if (px < minx) minx = px;
            if (px > maxx) maxx = px;
            if (py < miny) miny = py;
            if (py > maxy) maxy = py;
          }
          const pad = f.halfWidth + 1;
          const T = f.dark ? darkT : lightT;
          for (let y = Math.floor(miny - pad); y <= Math.ceil(maxy + pad); y++) {
            const wy = imod(y, H);
            for (let x = Math.floor(minx - pad); x <= Math.ceil(maxx + pad); x++) {
              const cov = fiberCoverage(f, x + 0.5, y + 0.5);
              if (cov <= 0) continue;
              const i = wy * W + imod(x, W);
              T[i] *= 1 - cov * f.alpha;
            }
          }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const dc = 1 - darkT[i];
      const lc = 1 - lightT[i];
      if (dc === 0 && lc === 0) continue;
      for (let c = 0; c < 3; c++) {
        let v = albedo[i * 3 + c];
        v += (fb.dark[c] - v) * dc;
        v += (fb.light[c] - v) * lc;
        albedo[i * 3 + c] = v;
      }
      height[i] += fb.relief * (1 - darkT[i] * lightT[i]);
    }
  }

  // ---- specks: weighted colour accumulation (order independent) ----
  const sp = r.specks;
  if (sp.count > 0 && sp.opacity > 0) {
    const T = new Float32Array(N).fill(1);
    const acc = new Float32Array(N * 4);
    const s2 = newSpeck();
    const slots = Math.ceil(sp.count);
    for (let cy = 0; cy < sp.per[1]; cy++) {
      for (let cx = 0; cx < sp.per[0]; cx++) {
        for (let k = 0; k < slots; k++) {
          if (!speckAt(r, cx, cy, cx, cy, k, s2)) continue;
          const ext = 1.32 * s2.ra + (0.66 * s2.ra) / s2.rb + 1;
          const col = sp.colors[s2.color];
          for (let y = Math.floor(s2.cy - ext); y <= Math.ceil(s2.cy + ext); y++) {
            const wy = imod(y, H);
            for (let x = Math.floor(s2.cx - ext); x <= Math.ceil(s2.cx + ext); x++) {
              const cov = speckCoverage(s2, x + 0.5, y + 0.5);
              if (cov <= 0) continue;
              const a = cov * s2.alpha;
              const i = wy * W + imod(x, W);
              T[i] *= 1 - a;
              acc[i * 4] += col[0] * a;
              acc[i * 4 + 1] += col[1] * a;
              acc[i * 4 + 2] += col[2] * a;
              acc[i * 4 + 3] += a;
            }
          }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const aa = acc[i * 4 + 3];
      if (aa <= 0) continue;
      const cov = 1 - T[i];
      for (let c = 0; c < 3; c++) {
        const v = albedo[i * 3 + c];
        albedo[i * 3 + c] = v + (acc[i * 4 + c] / aa - v) * cov;
      }
      height[i] += sp.relief * cov;
    }
  }

  if (mul) for (let i = 0; i < N * 3; i++) albedo[i] *= mul[i];

  return { width: W, height: H, albedo, height_: height };
}

/** Render RGBA8 maps for the requested outputs. */
export function renderCPU(r: ResolvedPaper, outputs: OutputMode[]): Record<string, Uint8ClampedArray> {
  const f = computeFields(r);
  const W = f.width;
  const H = f.height;
  const res: Record<string, Uint8ClampedArray> = {};
  const px = new Float64Array(4);
  for (const mode of outputs) {
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const yu = imod(y - 1, H) * W;
      const yd = imod(y + 1, H) * W;
      const yc = y * W;
      for (let x = 0; x < W; x++) {
        const xl = imod(x - 1, W);
        const xr = imod(x + 1, W);
        const i = yc + x;
        const hx = (f.height_[yc + xr] - f.height_[yc + xl]) * 0.5;
        const hy = (f.height_[yd + x] - f.height_[yu + x]) * 0.5;
        composePixel(r, mode, f.albedo[i * 3], f.albedo[i * 3 + 1], f.albedo[i * 3 + 2], f.height_[i], hx, hy, px);
        out[i * 4] = Math.round(px[0] * 255);
        out[i * 4 + 1] = Math.round(px[1] * 255);
        out[i * 4 + 2] = Math.round(px[2] * 255);
        out[i * 4 + 3] = 255;
      }
    }
    res[mode] = out;
  }
  return res;
}
