import { describe, expect, it } from 'vitest';
import { renderCPU } from '../src/cpu/renderer';
import { buildParams, presets, paramSchema, getParam, defaultParams, encodePNG } from '../src/index';
import { resolveParams } from '../src/resolve';
import type { OutputMode } from '../src/params';

/** Mean |a-b| across the wrap seam vs. the mean across interior neighbours. */
function seamRatio(data: Uint8ClampedArray, W: number, H: number) {
  const px = (x: number, y: number, c: number) => data[(y * W + x) * 4 + c];
  let seam = 0, inner = 0, ns = 0, ni = 0;
  for (let y = 0; y < H; y++)
    for (let c = 0; c < 3; c++) {
      seam += Math.abs(px(W - 1, y, c) - px(0, y, c)); ns++;
      for (const x of [W >> 2, W >> 1, (3 * W) >> 2]) { inner += Math.abs(px(x, y, c) - px(x - 1, y, c)); ni++; }
    }
  for (let x = 0; x < W; x++)
    for (let c = 0; c < 3; c++) {
      seam += Math.abs(px(x, H - 1, c) - px(x, 0, c)); ns++;
      for (const y of [H >> 2, H >> 1, (3 * H) >> 2]) { inner += Math.abs(px(x, y, c) - px(x, y - 1, c)); ni++; }
    }
  return { seam: seam / ns, inner: inner / ni };
}

const ALL: OutputMode[] = ['color', 'overlay', 'height', 'normal'];
const sample = ['printer', 'drawing-pad', 'construction-blue', 'pastel-mid-rose', 'pastel-black-patterned', 'handmade-ivory', 'watercolor-cold-press', 'kraft', 'cardboard-corrugated', 'newsprint-old'];

describe('tiling', () => {
  for (const id of sample) {
    for (const [W, H] of [[257, 190], [300, 300]]) {
      it(`${id} ${W}x${H} wraps seamlessly`, () => {
        const r = resolveParams(buildParams(id), W, H);
        const out = renderCPU(r, ALL);
        for (const m of ALL) {
          const { seam, inner } = seamRatio(out[m], W, H);
          // seam differences must look like ordinary neighbour differences
          expect(seam, `${m}: seam ${seam.toFixed(2)} inner ${inner.toFixed(2)}`).toBeLessThan(inner * 1.35 + 0.5);
        }
      });
    }
  }
});

describe('overlays tile', () => {
  const overlays = {
    crumples: { strength: 1, size: 70, wrinkles: 0.7, wrinkleSize: 18 },
    folds: { strength: 1, countX: 3, countY: 2, offset: 0.3 },
    stains: { density: 0.6, size: 30 },
  };
  for (const [W, H] of [[257, 190], [300, 300]]) {
    it(`crumples + folds + stains ${W}x${H}`, () => {
      const r = resolveParams(buildParams('kraft', overlays), W, H);
      expect(r.crumples.amp).toBeGreaterThan(0);
      const out = renderCPU(r, ALL);
      for (const m of ALL) {
        const { seam, inner } = seamRatio(out[m], W, H);
        expect(seam, `${m}: seam ${seam.toFixed(2)} inner ${inner.toFixed(2)}`).toBeLessThan(inner * 1.35 + 0.5);
      }
    });
  }
  it('params without overlay groups still resolve', () => {
    const p = buildParams('printer') as any;
    delete p.crumples;
    delete p.folds;
    delete p.stains;
    const r = resolveParams(p, 64, 64);
    expect(r.crumples.amp).toBe(0);
    expect(Number.isFinite(r.heightNorm)).toBe(true);
  });
});

describe('determinism', () => {
  it('same seed => identical pixels, different seed => different', () => {
    const a = renderCPU(resolveParams(buildParams('kraft', undefined, 5), 96, 96), ['color']).color;
    const b = renderCPU(resolveParams(buildParams('kraft', undefined, 5), 96, 96), ['color']).color;
    const c = renderCPU(resolveParams(buildParams('kraft', undefined, 6), 96, 96), ['color']).color;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });
});

describe('schema & presets', () => {
  it('every schema field exists in default params', () => {
    for (const g of paramSchema)
      for (const f of g.fields) {
        const path = g.key ? `${g.key}.${f.key}` : f.key;
        expect(getParam(defaultParams, path), path).not.toBeUndefined();
      }
  });
  it('preset ids are unique and resolve', () => {
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
    for (const p of presets) expect(() => resolveParams(p.params, 128, 128)).not.toThrow();
  });
});

describe('png', () => {
  it('encodes a valid PNG signature', async () => {
    const r = resolveParams(buildParams('printer'), 32, 16);
    const png = await encodePNG({ width: 32, height: 16, data: renderCPU(r, ['color']).color });
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
