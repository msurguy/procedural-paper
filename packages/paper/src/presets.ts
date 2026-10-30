import { parseColor, toHex } from './color';
import { defaultParams, mergeParams, type DeepPartial, type PaperParams } from './params';

export type PaperFamily = 'drawing' | 'construction' | 'pastel' | 'handmade' | 'watercolor' | 'craft';

export interface PaperPreset {
  id: string;
  name: string;
  family: PaperFamily;
  params: PaperParams;
}

type P = DeepPartial<PaperParams>;

/** Multiply a hex colour's channels (k < 1 darkens, > 1 lightens) with optional mix toward another colour. */
const shade = (hex: string, k: number, toward?: string, amt = 0) => {
  const c = parseColor(hex);
  const t = toward ? parseColor(toward) : c;
  return toHex(c.map((v, i) => (v + (t[i] - v) * amt) * k) as [number, number, number]);
};

/* ---------------- family templates ---------------- */

const OFF: P = {
  cells: { strength: 0 },
  streaks: { strength: 0 },
  structure: { type: 'none', strength: 0 },
};

const drawing: P = {
  ...OFF,
  color: { base: '#f8f8f5', tint: '#efece2', tintAmount: 0.15, variation: 0.012, grainTone: 0.066 },
  mottle: { size: 280, octaves: 4, warp: 0.5, relief: 0.05 },
  grain: { size: 3, strength: 0.3, roughness: 0.6, octaves: 3 },
  fibers: { density: 1.2, length: 14, width: 0.8, curl: 0.4, darkRatio: 0.3, darkColor: '#c8c4bb', lightColor: '#ffffff', opacity: 0.3, relief: 0.3 },
  specks: { density: 4.5, sizeMin: 0.4, sizeMax: 1.1, elongation: 0.4, colors: ['#9a958c', '#b8b0a2', '#c9c2b5'], opacity: 0.5, relief: 0 },
  lighting: { depth: 0.36, azimuth: 225, elevation: 45 },
};

const construction = (base: string): P => ({
  ...OFF,
  color: { base, tint: shade(base, 0.92), tintAmount: 0.4, variation: 0.02, grainTone: 0.11 },
  mottle: { size: 220, octaves: 5, warp: 0.6, relief: 0.08 },
  grain: { size: 3.5, strength: 0.4, roughness: 0.6, octaves: 4 },
  fibers: {
    density: 14,
    length: 16,
    width: 0.8,
    curl: 0.45,
    darkRatio: 0.7,
    darkColor: shade(base, 0.72),
    lightColor: shade(base, 1.12, '#ffffff', 0.25),
    opacity: 0.55,
    relief: 0.25,
  },
  specks: { density: 9.0, sizeMin: 0.4, sizeMax: 1.2, elongation: 0.3, colors: [shade(base, 0.6), shade(base, 1.2, '#ffffff', 0.4), '#e8e2d0'], opacity: 0.6, relief: 0.2 },
  lighting: { depth: 0.44, azimuth: 225, elevation: 45 },
});

const pastel = (base: string): P => ({
  ...OFF,
  color: { base, tint: shade(base, 0.95), tintAmount: 0.3, variation: 0.012, grainTone: 0.11 },
  mottle: { size: 260, octaves: 4, warp: 0.4, relief: 0.04 },
  grain: { size: 2.5, strength: 0.45, roughness: 0.6, octaves: 3 },
  fibers: {
    density: 80,
    length: 15,
    width: 0.75,
    curl: 1.0,
    darkRatio: 0.92,
    darkColor: shade(base, 0.68, '#484850', 0.3),
    lightColor: shade(base, 1.1, '#ffffff', 0.3),
    opacity: 0.5,
    relief: 0.15,
  },
  specks: { density: 2.4, sizeMin: 0.6, sizeMax: 1.6, elongation: 0.2, colors: [shade(base, 0.4), shade(base, 0.6), shade(base, 0.8)], opacity: 0.8, relief: 0 },
  lighting: { depth: 0.48, azimuth: 225, elevation: 45 },
});

const handmade = (base: string): P => ({
  ...OFF,
  color: { base, tint: shade(base, 0.9, '#c8a070', 0.15), tintAmount: 0.5, variation: 0.035, grainTone: 0.132 },
  mottle: { size: 360, octaves: 5, warp: 0.8, relief: 0.25 },
  grain: { size: 4, strength: 0.45, roughness: 0.62, octaves: 4 },
  cells: { size: 22, strength: 0.25, ridge: 0.2, warp: 0.8 },
  fibers: {
    density: 3,
    length: 46,
    width: 0.9,
    curl: 0.7,
    darkRatio: 0.55,
    darkColor: shade(base, 0.62, '#6b4a30', 0.3),
    lightColor: shade(base, 1.08, '#ffffff', 0.4),
    opacity: 0.35,
    relief: 0.35,
  },
  specks: { density: 150, sizeMin: 0.4, sizeMax: 2.6, elongation: 0.8, colors: ['#3a302a', '#9a6c48', '#c8a27c'], opacity: 0.75, relief: 0.3 },
  lighting: { depth: 0.64, azimuth: 225, elevation: 45 },
});

const craft = (base: string): P => ({
  ...OFF,
  color: { base, tint: shade(base, 0.92, '#806048', 0.2), tintAmount: 0.4, variation: 0.025, grainTone: 0.132 },
  mottle: { size: 240, octaves: 5, warp: 0.6, relief: 0.08 },
  grain: { size: 3, strength: 0.45, roughness: 0.62, octaves: 4 },
  fibers: {
    density: 70,
    length: 12,
    width: 0.75,
    curl: 0.5,
    darkRatio: 0.45,
    darkColor: shade(base, 0.72, '#5a3a28', 0.2),
    lightColor: shade(base, 1.14, '#f0dcc0', 0.25),
    opacity: 0.45,
    relief: 0.25,
  },
  specks: { density: 42.0, sizeMin: 0.5, sizeMax: 2.2, elongation: 0.7, colors: ['#3c2a22', '#7a4e38', '#e8dcc8'], opacity: 0.7, relief: 0.25 },
  lighting: { depth: 0.44, azimuth: 225, elevation: 45 },
});

const watercolor = (base: string): P => ({
  ...OFF,
  color: { base, tint: shade(base, 0.97, '#e8dcc8', 0.3), tintAmount: 0.25, variation: 0.012, grainTone: 0.12 },
  mottle: { size: 300, octaves: 4, warp: 0.5, relief: 0.1 },
  grain: { size: 3, strength: 0.5, roughness: 0.6, octaves: 3 },
  cells: { size: 8, strength: 0.7, ridge: 0.1, warp: 0.45 },
  fibers: { density: 1, length: 12, width: 0.7, curl: 0.5, darkRatio: 0.5, darkColor: '#b8b4a8', lightColor: '#ffffff', opacity: 0.2, relief: 0.2 },
  specks: { density: 7.5, sizeMin: 0.4, sizeMax: 1.2, elongation: 0.6, colors: ['#3a3836', '#8a3a48', '#7a6a50'], opacity: 0.7, relief: 0 },
  lighting: { depth: 0.4, azimuth: 225, elevation: 50 },
});

/* ---------------- preset list ---------------- */

const defs: { id: string; name: string; family: PaperFamily; layers: P[] }[] = [
  // drawing
  { id: 'printer', name: 'Printer Paper', family: 'drawing', layers: [drawing, { color: { base: '#f6f7f6' }, grain: { size: 2.5, strength: 0.25 }, lighting: { depth: 0.24 } }] },
  { id: 'drawing-pad', name: 'Drawing Pad', family: 'drawing', layers: [drawing, { color: { base: '#fafaf7' }, streaks: { length: 30, width: 2, strength: 0.3, direction: 'horizontal' }, lighting: { depth: 0.52 } }] },
  { id: 'sketchbook', name: 'Sketchbook', family: 'drawing', layers: [drawing, { color: { base: '#f8f8f4' }, streaks: { length: 22, width: 2.5, strength: 0.35 }, grain: { strength: 0.4 }, lighting: { depth: 0.48 } }] },
  { id: 'sketchbook-cream', name: 'Sketchbook Cream', family: 'drawing', layers: [drawing, { color: { base: '#fcf9e9', tint: '#f3ead0' }, streaks: { length: 22, width: 2.5, strength: 0.3 }, grain: { strength: 0.4 }, lighting: { depth: 0.44 } }] },
  {
    id: 'newsprint',
    name: 'Newsprint',
    family: 'drawing',
    layers: [
      drawing,
      {
        color: { base: '#dcd2ca', tint: '#d0c0b0', tintAmount: 0.35, variation: 0.03 },
        grain: { size: 3, strength: 0.35 },
        fibers: { density: 9, length: 12, darkRatio: 0.7, darkColor: '#a89888', lightColor: '#ece6de', opacity: 0.35 },
        specks: { density: 24.0, colors: ['#5a5048', '#8a7868', '#a89080'] },
      },
    ],
  },
  {
    id: 'newsprint-old',
    name: 'Newsprint Old',
    family: 'drawing',
    layers: [
      drawing,
      {
        color: { base: '#e0cbb3', tint: '#cfae8c', tintAmount: 0.5, variation: 0.045 },
        mottle: { size: 200, warp: 0.9 },
        grain: { size: 3, strength: 0.35 },
        streaks: { length: 120, width: 3, strength: 0.12, direction: 'vertical' },
        fibers: { density: 7, length: 18, darkRatio: 0.8, darkColor: '#b08a78', lightColor: '#efe0cc', opacity: 0.3 },
        specks: { density: 18.0, colors: ['#504860', '#9a7058', '#b89070'] },
      },
    ],
  },
  { id: 'construction-white', name: 'Construction White', family: 'drawing', layers: [construction('#f6fafb'), { fibers: { darkColor: '#d6dde2', density: 4 } }] },

  // construction
  ...(
    [
      ['red', 'Red', '#c93e55'],
      ['orange', 'Orange', '#f66c53'],
      ['yellow', 'Yellow', '#f6ba66'],
      ['green', 'Green', '#6fbb84'],
      ['blue', 'Blue', '#698bd3'],
      ['sky', 'Sky', '#9ac1d4'],
      ['purple', 'Purple', '#775390'],
      ['brown', 'Brown', '#9c6b5d'],
      ['black', 'Black', '#433f40'],
    ] as const
  ).map(([id, name, base]) => ({
    id: `construction-${id}`,
    name: `Construction ${name}`,
    family: 'construction' as const,
    layers: [construction(base), id === 'black' ? { fibers: { darkColor: '#2a2627', lightColor: '#6a6466' } } : {}],
  })),
  { id: 'construction-overlay', name: 'Construction Overlay', family: 'construction', layers: [construction('#808080')] },

  // pastel (Mi-Teintes-like)
  ...(
    [
      ['white', 'White', '#f0f0f0'],
      ['light-cream', 'Light Cream', '#f2eee3'],
      ['light-yellow', 'Light Yellow', '#e3dbbe'],
      ['light-gray', 'Light Gray', '#dcdbdc'],
      ['light-gray-warm', 'Light Gray Warm', '#d6d0c9'],
      ['light-cool', 'Light Cool', '#e8eae9'],
      ['mid-rose', 'Mid Rose', '#beada9'],
      ['mid-green', 'Mid Green', '#b0b9b3'],
      ['mid-gray', 'Mid Gray', '#b0aaa6'],
      ['mid-gray-cool', 'Mid Gray Cool', '#c4c5ca'],
      ['mid-cool', 'Mid Cool', '#adb3b2'],
      ['mid-warm', 'Mid Warm', '#a7a09a'],
      ['dark-gray', 'Dark Gray', '#838383'],
      ['dark-gray-warm', 'Dark Gray Warm', '#918a85'],
      ['dark-cool', 'Dark Cool', '#83878c'],
      ['dark-green', 'Dark Green', '#858b87'],
      ['dark-rose', 'Dark Rose', '#9e8e8e'],
      ['dark-warm', 'Dark Warm', '#908b87'],
      ['dark-blue', 'Dark Blue', '#61657b'],
      ['black', 'Black', '#3b3739'],
    ] as const
  ).map(([id, name, base]) => ({
    id: `pastel-${id}`,
    name: `Pastel ${name}`,
    family: 'pastel' as const,
    layers: [pastel(base), id === 'black' ? { fibers: { darkRatio: 0.3, lightColor: '#6a6668', darkColor: '#262224' } } : {}],
  })),
  {
    id: 'pastel-black-patterned',
    name: 'Pastel Black Patterned',
    family: 'pastel',
    layers: [
      pastel('#333133'),
      {
        structure: { type: 'honeycomb', spacing: 5, strength: 0.55, sharpness: 0.3, direction: 'horizontal', warp: 0.5 },
        fibers: { darkRatio: 0.2, lightColor: '#5a5458', darkColor: '#1e1c1e', density: 14, opacity: 0.35 },
        lighting: { depth: 0.8 },
      },
    ],
  },
  {
    id: 'parchment',
    name: 'Parchment',
    family: 'pastel',
    layers: [pastel('#f3dbc3'), { fibers: { density: 8, darkRatio: 0.4, opacity: 0.2 }, mottle: { size: 160, warp: 1 }, color: { variation: 0.03, tint: '#ead0b4', tintAmount: 0.5 } }],
  },
  { id: 'pastel-overlay', name: 'Pastel Overlay', family: 'pastel', layers: [pastel('#808080')] },

  // handmade
  { id: 'handmade-ivory', name: 'Handmade Ivory', family: 'handmade', layers: [handmade('#efe7d6')] },
  { id: 'oatmeal', name: 'Oatmeal', family: 'handmade', layers: [handmade('#f2efdd'), { specks: { density: 180.0, sizeMax: 3.6, colors: ['#5a4a38', '#a08868', '#c8b898'] } }] },
  { id: 'handmade-green', name: 'Handmade Green', family: 'handmade', layers: [handmade('#8d9078')] },
  { id: 'handmade-yellow', name: 'Handmade Yellow', family: 'handmade', layers: [handmade('#c99355')] },
  { id: 'handmade-navy', name: 'Handmade Navy', family: 'handmade', layers: [handmade('#544e5d'), { specks: { colors: ['#2a2630', '#8a8090', '#b0a8b8'] } }] },
  { id: 'handmade-sky', name: 'Handmade Sky', family: 'handmade', layers: [handmade('#959dad')] },
  { id: 'handmade-rust', name: 'Handmade Rust', family: 'handmade', layers: [handmade('#92534a')] },
  { id: 'handmade-overlay', name: 'Handmade Overlay', family: 'handmade', layers: [handmade('#808080'), { specks: { colors: ['#404040', '#606060', '#a0a0a0'] } }] },

  // watercolor
  { id: 'watercolor-cold-press', name: 'Watercolor Cold Press', family: 'watercolor', layers: [watercolor('#f2f2ea')] },
  { id: 'watercolor-hot-press', name: 'Watercolor Hot Press', family: 'watercolor', layers: [watercolor('#f5f1ee'), { cells: { size: 12, strength: 0.25 }, grain: { strength: 0.35 }, lighting: { depth: 0.44 } }] },
  { id: 'watercolor-rough', name: 'Watercolor Rough', family: 'watercolor', layers: [watercolor('#f3f1e8'), { cells: { size: 20, strength: 1.3, warp: 0.7 }, mottle: { relief: 0.2 }, lighting: { depth: 0.88 } }] },

  // craft & cardboard
  { id: 'kraft', name: 'Kraft Paper', family: 'craft', layers: [craft('#a8856f')] },
  { id: 'kraft-rough', name: 'Kraft Rough', family: 'craft', layers: [craft('#a7836e'), { grain: { strength: 0.6, size: 3.5 }, fibers: { density: 20 }, lighting: { depth: 0.56 } }] },
  { id: 'kraft-light', name: 'Kraft Light', family: 'craft', layers: [craft('#d3bca5')] },
  { id: 'kraft-gray', name: 'Kraft Gray', family: 'craft', layers: [craft('#b3a599'), { color: { tint: '#a89080' } }] },
  {
    id: 'chipboard',
    name: 'Chipboard',
    family: 'craft',
    layers: [craft('#9d8a7b'), { fibers: { density: 10, length: 22, curl: 0.25, darkRatio: 0.25, lightColor: '#d8ccb8', opacity: 0.4 }, specks: { density: 72.0, colors: ['#3a302a', '#8a3a30', '#e0d8c8'] } }],
  },
  { id: 'cardboard', name: 'Cardboard', family: 'craft', layers: [craft('#a6866f'), { mottle: { size: 160 }, color: { variation: 0.035 } }] },
  {
    id: 'cardboard-corrugated',
    name: 'Cardboard Corrugated',
    family: 'craft',
    layers: [craft('#a5856e'), { structure: { type: 'corrugated', spacing: 90, strength: 0.25, sharpness: 0.2, direction: 'horizontal', warp: 0.1 }, color: { grainTone: 0.176 } }],
  },
];

export const presets: PaperPreset[] = defs.map((d) => ({
  id: d.id,
  name: d.name,
  family: d.family,
  params: mergeParams(defaultParams, ...d.layers),
}));

export const presetMap: Record<string, PaperPreset> = Object.fromEntries(presets.map((p) => [p.id, p]));

export function getPreset(id: string): PaperPreset {
  const p = presetMap[id];
  if (!p) throw new Error(`procedural-paper: unknown preset "${id}"`);
  return p;
}
