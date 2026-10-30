/**
 * Paper parameters. All sizes are in pixels at `scale = 1`; `scale` multiplies
 * every feature size so the same look can be rendered at higher resolutions.
 * Every layer is disabled by setting its strength/density/opacity to 0.
 */

export type StructureType = 'none' | 'corrugated' | 'laid' | 'honeycomb' | 'canvas';
export type Direction = 'horizontal' | 'vertical';
export type OutputMode = 'color' | 'albedo' | 'overlay' | 'height' | 'normal';

export interface PaperParams {
  seed: number;
  /** Multiplies every feature size (use 2 for a 2x resolution render of the same look). */
  scale: number;
  color: {
    /** Base paper color (CSS hex). */
    base: string;
    /** Secondary color blended in through low-frequency noise (aging, dye unevenness). */
    tint: string;
    tintAmount: number;
    /** Brightness variation from the mottle layer. */
    variation: number;
    /** How much the surface height (grain/cells/streaks) darkens/brightens the color directly. */
    grainTone: number;
  };
  mottle: { size: number; octaves: number; warp: number; relief: number };
  grain: { size: number; strength: number; roughness: number; octaves: number };
  cells: { size: number; strength: number; ridge: number; warp: number };
  streaks: { length: number; width: number; strength: number; direction: Direction };
  fibers: {
    /** Fibers per 100x100 px. */
    density: number;
    length: number;
    width: number;
    curl: number;
    /** 0 = all light fibers, 1 = all dark fibers. */
    darkRatio: number;
    darkColor: string;
    lightColor: string;
    opacity: number;
    relief: number;
  };
  specks: {
    /** Specks per 512x512 px. */
    density: number;
    sizeMin: number;
    sizeMax: number;
    /** 0 = round dots, 1+ = long plant-matter slivers. */
    elongation: number;
    colors: [string, string, string];
    opacity: number;
    relief: number;
  };
  structure: {
    type: StructureType;
    spacing: number;
    strength: number;
    sharpness: number;
    direction: Direction;
    warp: number;
  };
  /**
   * Sheet-scale overlays (after the "paper texture" shader by Paper Shaders,
   * reworked to tile): faceted crumples + fine wrinkles, fold lines, and stains.
   * Their relief is normalised by `lighting.depth`, so a given strength reads
   * the same on every paper.
   */
  crumples: {
    strength: number;
    /** Facet size in px. */
    size: number;
    wrinkles: number;
    wrinkleSize: number;
    /** Bends the crease lines. */
    warp: number;
  };
  folds: {
    strength: number;
    /** Number of vertical fold lines across the tile (0 = none). */
    countX: number;
    /** Number of horizontal fold lines across the tile (0 = none). */
    countY: number;
    /** Shifts the fold lines, as a fraction of their spacing. */
    offset: number;
    /** Width of the ridge along each fold (px). */
    width: number;
    /** Darkening of worn fibers along the crease. */
    wear: number;
  };
  stains: {
    /** Chance (0..1) of a stain per stain-sized cell. */
    density: number;
    /** Stain radius in px. */
    size: number;
    strength: number;
    /** Dark tide-line at the stain edge. */
    ring: number;
    color: string;
  };
  lighting: {
    /** Relief depth: how strongly the height field shades the surface. */
    depth: number;
    /** Light direction in degrees (0 = from the right, 90 = from below, 270 = from above). */
    azimuth: number;
    elevation: number;
  };
  output: {
    brightness: number;
    contrast: number;
    /** Flip normal map green channel (DirectX convention). */
    normalFlipY: boolean;
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const defaultParams: PaperParams = {
  seed: 1,
  scale: 1,
  color: { base: '#f2efe8', tint: '#e8dcc4', tintAmount: 0.15, variation: 0.04, grainTone: 0.04 },
  mottle: { size: 320, octaves: 4, warp: 0.4, relief: 0.1 },
  grain: { size: 6, strength: 0.4, roughness: 0.55, octaves: 4 },
  cells: { size: 14, strength: 0, ridge: 0, warp: 0.3 },
  streaks: { length: 60, width: 3, strength: 0, direction: 'horizontal' },
  fibers: {
    density: 4,
    length: 18,
    width: 1,
    curl: 0.3,
    darkRatio: 0.5,
    darkColor: '#8a8070',
    lightColor: '#ffffff',
    opacity: 0.25,
    relief: 0.2,
  },
  specks: {
    density: 6,
    sizeMin: 0.6,
    sizeMax: 2.2,
    elongation: 0.3,
    colors: ['#3a3430', '#8a6a50', '#b89878'],
    opacity: 0.7,
    relief: 0.2,
  },
  structure: { type: 'none', spacing: 24, strength: 0, sharpness: 0.5, direction: 'horizontal', warp: 0.2 },
  crumples: { strength: 0, size: 140, wrinkles: 0, wrinkleSize: 26, warp: 0.12 },
  folds: { strength: 0, countX: 2, countY: 2, offset: 0, width: 3, wear: 0.4 },
  stains: { density: 0, size: 60, strength: 0.5, ring: 0.6, color: '#9a6a3a' },
  lighting: { depth: 1, azimuth: 225, elevation: 45 },
  output: { brightness: 0, contrast: 1, normalFlipY: false },
};

/* ---------- schema (drives UIs, validation, docs) ---------- */

export type ParamField =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number }
  | { key: string; label: string; type: 'color' }
  | { key: string; label: string; type: 'select'; options: readonly string[] }
  | { key: string; label: string; type: 'boolean' };

export interface ParamGroup {
  key: string;
  label: string;
  fields: ParamField[];
}

const n = (key: string, label: string, min: number, max: number, step: number): ParamField => ({
  key,
  label,
  type: 'number',
  min,
  max,
  step,
});
const c = (key: string, label: string): ParamField => ({ key, label, type: 'color' });

export const paramSchema: ParamGroup[] = [
  { key: '', label: 'General', fields: [n('seed', 'Seed', 0, 9999, 1), n('scale', 'Scale', 0.25, 4, 0.05)] },
  {
    key: 'color',
    label: 'Color',
    fields: [
      c('base', 'Base'),
      c('tint', 'Tint'),
      n('tintAmount', 'Tint amount', 0, 1, 0.01),
      n('variation', 'Mottle tone', 0, 0.3, 0.005),
      n('grainTone', 'Grain tone', 0, 0.3, 0.005),
    ],
  },
  {
    key: 'mottle',
    label: 'Mottle (clouds)',
    fields: [
      n('size', 'Size', 20, 2000, 1),
      n('octaves', 'Octaves', 1, 8, 1),
      n('warp', 'Warp', 0, 2, 0.01),
      n('relief', 'Relief', 0, 1, 0.01),
    ],
  },
  {
    key: 'grain',
    label: 'Grain (tooth)',
    fields: [
      n('size', 'Size', 1, 64, 0.5),
      n('strength', 'Strength', 0, 2, 0.01),
      n('roughness', 'Roughness', 0.2, 0.9, 0.01),
      n('octaves', 'Octaves', 1, 8, 1),
    ],
  },
  {
    key: 'cells',
    label: 'Cells (cold press)',
    fields: [
      n('size', 'Size', 3, 120, 0.5),
      n('strength', 'Strength', 0, 2, 0.01),
      n('ridge', 'Ridge', 0, 1, 0.01),
      n('warp', 'Warp', 0, 1.5, 0.01),
    ],
  },
  {
    key: 'streaks',
    label: 'Streaks (drag)',
    fields: [
      n('length', 'Length', 4, 400, 1),
      n('width', 'Width', 1, 40, 0.5),
      n('strength', 'Strength', 0, 2, 0.01),
      { key: 'direction', label: 'Direction', type: 'select', options: ['horizontal', 'vertical'] },
    ],
  },
  {
    key: 'fibers',
    label: 'Fibers',
    fields: [
      n('density', 'Density', 0, 120, 0.5),
      n('length', 'Length', 2, 120, 0.5),
      n('width', 'Width', 0.3, 6, 0.05),
      n('curl', 'Curl', 0, 1.5, 0.01),
      n('darkRatio', 'Dark ratio', 0, 1, 0.01),
      c('darkColor', 'Dark color'),
      c('lightColor', 'Light color'),
      n('opacity', 'Opacity', 0, 1, 0.01),
      n('relief', 'Relief', 0, 2, 0.01),
    ],
  },
  {
    key: 'specks',
    label: 'Specks & inclusions',
    fields: [
      n('density', 'Density', 0, 300, 0.5),
      n('sizeMin', 'Size min', 0.3, 10, 0.05),
      n('sizeMax', 'Size max', 0.3, 24, 0.05),
      n('elongation', 'Elongation', 0, 6, 0.05),
      c('colors.0', 'Color 1'),
      c('colors.1', 'Color 2'),
      c('colors.2', 'Color 3'),
      n('opacity', 'Opacity', 0, 1, 0.01),
      n('relief', 'Relief', 0, 2, 0.01),
    ],
  },
  {
    key: 'structure',
    label: 'Structure',
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: ['none', 'corrugated', 'laid', 'honeycomb', 'canvas'] },
      n('spacing', 'Spacing', 2, 200, 0.5),
      n('strength', 'Strength', 0, 2, 0.01),
      n('sharpness', 'Sharpness', 0, 1, 0.01),
      { key: 'direction', label: 'Direction', type: 'select', options: ['horizontal', 'vertical'] },
      n('warp', 'Warp', 0, 1, 0.01),
    ],
  },
  {
    key: 'crumples',
    label: 'Crumples & wrinkles',
    fields: [
      n('strength', 'Crumples', 0, 2, 0.01),
      n('size', 'Facet size', 20, 1000, 1),
      n('wrinkles', 'Wrinkles', 0, 2, 0.01),
      n('wrinkleSize', 'Wrinkle size', 4, 200, 0.5),
      n('warp', 'Warp', 0, 1, 0.01),
    ],
  },
  {
    key: 'folds',
    label: 'Folds',
    fields: [
      n('strength', 'Strength', 0, 2, 0.01),
      n('countX', 'Vertical', 0, 16, 1),
      n('countY', 'Horizontal', 0, 16, 1),
      n('offset', 'Offset', 0, 1, 0.01),
      n('width', 'Ridge width', 1, 60, 0.5),
      n('wear', 'Wear', 0, 1, 0.01),
    ],
  },
  {
    key: 'stains',
    label: 'Stains',
    fields: [
      n('density', 'Density', 0, 1, 0.01),
      n('size', 'Size', 4, 400, 1),
      n('strength', 'Strength', 0, 1, 0.01),
      n('ring', 'Tide line', 0, 1, 0.01),
      c('color', 'Color'),
    ],
  },
  {
    key: 'lighting',
    label: 'Lighting',
    fields: [n('depth', 'Depth', 0, 6, 0.01), n('azimuth', 'Azimuth', 0, 360, 1), n('elevation', 'Elevation', 5, 90, 1)],
  },
  {
    key: 'output',
    label: 'Output',
    fields: [
      n('brightness', 'Brightness', -0.5, 0.5, 0.005),
      n('contrast', 'Contrast', 0, 3, 0.01),
      { key: 'normalFlipY', label: 'Normal: flip Y (DirectX)', type: 'boolean' },
    ],
  },
];

/* ---------- helpers ---------- */

export function cloneParams(p: PaperParams): PaperParams {
  return {
    ...p,
    color: { ...p.color },
    mottle: { ...p.mottle },
    grain: { ...p.grain },
    cells: { ...p.cells },
    streaks: { ...p.streaks },
    fibers: { ...p.fibers },
    specks: { ...p.specks, colors: [...p.specks.colors] as [string, string, string] },
    structure: { ...p.structure },
    // overlay groups were added later; fill them in for older param objects
    crumples: { ...defaultParams.crumples, ...p.crumples },
    folds: { ...defaultParams.folds, ...p.folds },
    stains: { ...defaultParams.stains, ...p.stains },
    lighting: { ...p.lighting },
    output: { ...p.output },
  };
}

/** Deep-merge `overrides` onto `base` (arrays are replaced, not merged). Returns a new object. */
export function mergeParams(base: PaperParams, ...overrides: (DeepPartial<PaperParams> | undefined)[]): PaperParams {
  const out = cloneParams(base) as any;
  for (const o of overrides) {
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = { ...out[k] };
        for (const [k2, v2] of Object.entries(v)) {
          if (v2 === undefined) continue;
          out[k][k2] = Array.isArray(v2) ? [...v2] : v2;
        }
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

/** Read a value by dotted path, e.g. `getParam(p, 'specks.colors.1')`. */
export function getParam(p: PaperParams, path: string): unknown {
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), p);
}

/** Return a copy of `p` with the value at a dotted path replaced. */
export function setParam(p: PaperParams, path: string, value: unknown): PaperParams {
  const out = cloneParams(p) as any;
  const keys = path.split('.');
  let o = out;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
  return out;
}
