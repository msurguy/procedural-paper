import { layerSeed } from './hash';
import { luminance, parseColor, type RGB } from './color';
import { cloneParams, type PaperParams } from './params';

/** Maximum fiber / speck slots evaluated per grid cell (shared with the shader). */
export const MAX_SLOTS = 32;

export const STRUCTURE_TYPES = ['none', 'corrugated', 'laid', 'honeycomb', 'canvas'] as const;

/**
 * Renderer-ready numbers derived from `PaperParams` for a specific tile size.
 * Every feature size is snapped to an integer number of cells across the tile,
 * which is what makes all layers wrap seamlessly.
 */
export interface ResolvedPaper {
  width: number;
  height: number;
  base: RGB;
  baseLum: number;
  tint: RGB;
  tintAmount: number;
  variation: number;
  grainTone: number;

  mottle: { seed: number; tintSeed: number; warpSeed: number; per: [number, number]; octaves: number; warp: number; relief: number };
  grain: { seed: number; per: [number, number]; octaves: number; roughness: number; strength: number };
  cells: { seed: number; warpSeed: number; per: [number, number]; strength: number; ridge: number; warp: number };
  streaks: { seed: number; per: [number, number]; octaves: number; strength: number };
  fibers: {
    seed: number;
    per: [number, number];
    cell: [number, number];
    count: number;
    length: number;
    width: number;
    curl: number;
    darkRatio: number;
    dark: RGB;
    light: RGB;
    opacity: number;
    relief: number;
  };
  specks: {
    seed: number;
    per: [number, number];
    cell: [number, number];
    count: number;
    sizeMin: number;
    sizeMax: number;
    elongation: number;
    colors: [RGB, RGB, RGB];
    opacity: number;
    relief: number;
  };
  structure: {
    type: number;
    seed: number;
    /** Repeats across the tile along the (main, cross) axes. */
    per: [number, number];
    strength: number;
    sharpness: number;
    vertical: boolean;
    warp: number;
  };
  crumples: { seed: number; warpSeed: number; per: [number, number]; wPer: [number, number]; amp: number; wAmp: number; warp: number };
  folds: { seed: number; count: [number, number]; offset: number; strength: number; width: number; wear: number };
  stains: { seed: number; per: [number, number]; cell: [number, number]; density: number; size: number; strength: number; ring: number; color: RGB };
  light: { dir: [number, number, number]; depth: number };
  /** Multiplier mapping summed heights to roughly [-1, 1] for height-map export. */
  heightNorm: number;
  output: { brightness: number; contrast: number; flipY: boolean };
}

const periods = (w: number, h: number, sx: number, sy = sx): [number, number] => [
  Math.max(1, Math.round(w / Math.max(sx, 1e-3))),
  Math.max(1, Math.round(h / Math.max(sy, 1e-3))),
];

/** Limit octaves so the finest octave is no smaller than ~1.5 px. */
const capOctaves = (oct: number, per: [number, number], w: number, h: number) => {
  let o = Math.max(1, Math.round(oct));
  while (o > 1 && (per[0] * 2 ** (o - 1) > w / 1.5 || per[1] * 2 ** (o - 1) > h / 1.5)) o--;
  return o;
};

export function resolveParams(params: PaperParams, width: number, height: number): ResolvedPaper {
  const p = cloneParams(params);
  const W = Math.max(1, Math.round(width));
  const H = Math.max(1, Math.round(height));
  const s = Math.max(0.01, p.scale);
  const seed = Math.round(p.seed) >>> 0;
  const base = parseColor(p.color.base);

  // mottle
  const mPer = periods(W, H, p.mottle.size * s);
  // grain
  const gPer = periods(W, H, p.grain.size * s);
  // cells
  const cPer = periods(W, H, p.cells.size * s);
  // streaks: long along the drag direction, narrow across it
  const horiz = p.streaks.direction !== 'vertical';
  const sl = p.streaks.length * s;
  const sw = p.streaks.width * s;
  const stPer = horiz ? periods(W, H, sl, sw) : periods(W, H, sw, sl);

  // fibers: cell must contain the whole fiber extent so a 3x3 neighbourhood suffices
  const fLen = Math.min(p.fibers.length * s, Math.min(W, H) * 0.45);
  const fWidth = p.fibers.width * s;
  const fCurl = Math.max(0, p.fibers.curl);
  const fExtent = fLen * (0.5 + 0.75 * fCurl) + fWidth * 0.7 + 1;
  const fPer: [number, number] = [
    Math.max(1, Math.floor(W / (2 * fExtent))),
    Math.max(1, Math.floor(H / (2 * fExtent))),
  ];
  const fCell: [number, number] = [W / fPer[0], H / fPer[1]];
  const fCount = Math.min(MAX_SLOTS, (p.fibers.density * fCell[0] * fCell[1]) / 10000);

  // specks
  const sMin = Math.max(0.2, p.specks.sizeMin * s);
  const sMax = Math.max(sMin, p.specks.sizeMax * s);
  const sElong = 1 + Math.max(0, p.specks.elongation);
  // irregular outline reaches 1.32x radius; anti-aliased edge adds ~0.66 * ra/rb px
  const sExtent = Math.min(1.32 * sMax * sElong + 0.66 * sElong + 1, Math.min(W, H) * 0.45);
  const sCellTarget = Math.max(2 * sExtent, 48 * s);
  const sPer: [number, number] = [
    Math.max(1, Math.floor(W / sCellTarget)),
    Math.max(1, Math.floor(H / sCellTarget)),
  ];
  const sCell: [number, number] = [W / sPer[0], H / sPer[1]];
  const sCount = Math.min(MAX_SLOTS, (p.specks.density * sCell[0] * sCell[1]) / 262144);

  // structure
  const vertical = p.structure.direction === 'vertical';
  const mainLen = vertical ? W : H; // corrugation lines run along `direction`, repeat across it
  const crossLen = vertical ? H : W;
  const sp = Math.max(1, p.structure.spacing * s);
  const structPer: [number, number] = [
    Math.max(1, Math.round(mainLen / sp)),
    Math.max(1, Math.round(crossLen / (p.structure.type === 'laid' ? sp * 12 : sp))),
  ];
  if (p.structure.type === 'honeycomb' && structPer[0] % 2 === 1) structPer[0] += 1; // offset rows need an even count

  const az = (p.lighting.azimuth * Math.PI) / 180;
  const el = (Math.min(89.5, Math.max(1, p.lighting.elevation)) * Math.PI) / 180;

  // overlays: relief normalised by lighting depth so strength reads the same on any paper
  const norm = 0.5 / Math.max(0.05, p.lighting.depth);
  const crPer = periods(W, H, p.crumples.size * s);
  const crCell = (W / crPer[0] + H / crPer[1]) / 2;
  const wrPer = periods(W, H, p.crumples.wrinkleSize * s);
  const wrCell = (W / wrPer[0] + H / wrPer[1]) / 2;
  const crAmp = Math.max(0, p.crumples.strength) * crCell * 0.25 * norm;
  const wrAmp = Math.max(0, p.crumples.wrinkles) * wrCell * 0.25 * norm;
  const foOn = p.folds.strength > 0;
  const foCount: [number, number] = foOn ? [Math.max(0, Math.round(p.folds.countX)), Math.max(0, Math.round(p.folds.countY))] : [0, 0];
  const foStrength = Math.max(0, p.folds.strength) * norm;
  const foWidth = Math.max(1, p.folds.width * s);
  const foAmp = foStrength * (0.2 * Math.max(foCount[0] ? W / foCount[0] : 0, foCount[1] ? H / foCount[1] : 0) + 0.5 * foWidth);
  const snPer = periods(W, H, 2.6 * Math.max(2, p.stains.size * s));
  const snCell: [number, number] = [W / snPer[0], H / snPer[1]];

  const sumStrength =
    p.mottle.relief +
    p.grain.strength +
    p.cells.strength +
    p.streaks.strength +
    p.structure.strength +
    p.fibers.relief * Math.min(1, p.fibers.opacity * 2) +
    p.specks.relief * Math.min(1, p.specks.opacity) +
    crAmp +
    1.5 * wrAmp +
    (foCount[0] || foCount[1] ? foAmp : 0);

  return {
    width: W,
    height: H,
    base,
    baseLum: luminance(base),
    tint: parseColor(p.color.tint),
    tintAmount: p.color.tintAmount,
    variation: p.color.variation,
    grainTone: p.color.grainTone,
    mottle: {
      seed: layerSeed(seed, 1),
      tintSeed: layerSeed(seed, 2),
      warpSeed: layerSeed(seed, 3),
      per: mPer,
      octaves: capOctaves(p.mottle.octaves, mPer, W, H),
      warp: p.mottle.warp,
      relief: p.mottle.relief,
    },
    grain: {
      seed: layerSeed(seed, 4),
      per: gPer,
      octaves: capOctaves(p.grain.octaves, gPer, W, H),
      roughness: p.grain.roughness,
      strength: p.grain.strength,
    },
    cells: {
      seed: layerSeed(seed, 5),
      warpSeed: layerSeed(seed, 6),
      per: cPer,
      strength: p.cells.strength,
      ridge: p.cells.ridge,
      warp: p.cells.warp,
    },
    streaks: { seed: layerSeed(seed, 7), per: stPer, octaves: capOctaves(3, stPer, W, H), strength: p.streaks.strength },
    fibers: {
      seed: layerSeed(seed, 8),
      per: fPer,
      cell: fCell,
      count: fCount,
      length: fLen,
      width: fWidth,
      curl: fCurl,
      darkRatio: p.fibers.darkRatio,
      dark: parseColor(p.fibers.darkColor),
      light: parseColor(p.fibers.lightColor),
      opacity: p.fibers.opacity,
      relief: p.fibers.relief,
    },
    specks: {
      seed: layerSeed(seed, 9),
      per: sPer,
      cell: sCell,
      count: sCount,
      sizeMin: sMin,
      sizeMax: sMax,
      elongation: Math.max(0, p.specks.elongation),
      colors: p.specks.colors.map(parseColor) as [RGB, RGB, RGB],
      opacity: p.specks.opacity,
      relief: p.specks.relief,
    },
    structure: {
      type: Math.max(0, STRUCTURE_TYPES.indexOf(p.structure.type)),
      seed: layerSeed(seed, 10),
      per: structPer,
      strength: p.structure.type === 'none' ? 0 : p.structure.strength,
      sharpness: p.structure.sharpness,
      vertical,
      warp: p.structure.warp,
    },
    crumples: {
      seed: layerSeed(seed, 11),
      warpSeed: layerSeed(seed, 12),
      per: crPer,
      wPer: wrPer,
      amp: crAmp,
      wAmp: wrAmp,
      warp: Math.max(0, p.crumples.warp),
    },
    folds: {
      seed: layerSeed(seed, 13),
      count: foCount,
      offset: p.folds.offset,
      strength: foCount[0] || foCount[1] ? foStrength : 0,
      width: foWidth,
      wear: foCount[0] || foCount[1] ? p.folds.wear : 0,
    },
    stains: {
      seed: layerSeed(seed, 14),
      per: snPer,
      cell: snCell,
      density: Math.min(1, Math.max(0, p.stains.density)),
      size: Math.max(2, p.stains.size * s),
      strength: p.stains.strength,
      ring: p.stains.ring,
      color: parseColor(p.stains.color),
    },
    light: {
      dir: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)],
      depth: p.lighting.depth,
    },
    heightNorm: 1 / Math.max(0.05, sumStrength),
    output: { brightness: p.output.brightness, contrast: p.output.contrast, flipY: p.output.normalFlipY },
  };
}
