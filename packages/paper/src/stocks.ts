import { buildParams } from './index';
import { luminance, parseColor } from './color';
import type { DeepPartial, PaperParams } from './params';

export interface PaperSpec {
  preset: string;
  params?: DeepPartial<PaperParams>;
  label?: string;
}

const smooth = (base: string): PaperSpec => ({
  preset: 'printer',
  params: { color: { base, tint: base, variation: 0.03 }, grain: { strength: 0.18 }, fibers: { density: 1.5, opacity: 0.15 }, lighting: { depth: 0.2 } },
});

export const paperStocks: Record<string, PaperSpec> = {
  // stock presets
  printer: { preset: 'printer' },
  'drawing-pad': { preset: 'drawing-pad' },
  sketchbook: { preset: 'sketchbook' },
  'sketchbook-cream': { preset: 'sketchbook-cream' },
  newsprint: { preset: 'newsprint' },
  'newsprint-old': { preset: 'newsprint-old' },
  parchment: { preset: 'parchment' },
  'construction-white': { preset: 'construction-white' },
  'handmade-ivory': { preset: 'handmade-ivory' },
  oatmeal: { preset: 'oatmeal' },
  'handmade-green': { preset: 'handmade-green' },
  'handmade-yellow': { preset: 'handmade-yellow' },
  'handmade-navy': { preset: 'handmade-navy' },
  'handmade-sky': { preset: 'handmade-sky' },
  'handmade-rust': { preset: 'handmade-rust' },
  // finer tooth than the presets: these are seen at desk scale, not as a full-page scan
  'watercolor-cold-press': { preset: 'watercolor-cold-press', params: { cells: { size: 9, strength: 0.55 }, lighting: { depth: 0.3 } } },
  'watercolor-hot-press': { preset: 'watercolor-hot-press', params: { cells: { size: 8, strength: 0.2 }, lighting: { depth: 0.3 } } },
  'watercolor-rough': { preset: 'watercolor-rough', params: { cells: { size: 12, strength: 0.8 }, lighting: { depth: 0.45 } } },
  kraft: { preset: 'kraft' },
  'kraft-light': { preset: 'kraft-light' },
  'kraft-rough': { preset: 'kraft-rough' },
  'kraft-gray': { preset: 'kraft-gray' },
  chipboard: { preset: 'chipboard' },
  cardboard: { preset: 'cardboard' },
  'cardboard-corrugated': { preset: 'cardboard-corrugated' },
  'construction-red': { preset: 'construction-red' },
  'construction-orange': { preset: 'construction-orange' },
  'construction-yellow': { preset: 'construction-yellow' },
  'construction-green': { preset: 'construction-green' },
  'construction-blue': { preset: 'construction-blue' },
  'construction-sky': { preset: 'construction-sky' },
  'construction-purple': { preset: 'construction-purple' },
  'construction-black': { preset: 'construction-black' },
  'pastel-light-cream': { preset: 'pastel-light-cream' },
  'pastel-light-yellow': { preset: 'pastel-light-yellow' },
  'pastel-mid-rose': { preset: 'pastel-mid-rose' },
  'pastel-mid-green': { preset: 'pastel-mid-green' },
  'pastel-mid-cool': { preset: 'pastel-mid-cool' },
  'pastel-dark-blue': { preset: 'pastel-dark-blue' },
  'pastel-dark-rose': { preset: 'pastel-dark-rose' },
  'pastel-black': { preset: 'pastel-black' },
  'pastel-black-patterned': { preset: 'pastel-black-patterned' },

  // custom recipes
  // sticky notes get their colour per card (params.color)
  sticky: smooth('#f8e47e'),
  tracing: {
    preset: 'printer',
    params: { color: { base: '#f7f8f6', tint: '#f1f3f1', variation: 0.02 }, grain: { strength: 0.1 }, fibers: { density: 0 }, specks: { density: 0 }, lighting: { depth: 0.15 } },
  },
  washi: {
    preset: 'printer',
    params: { color: { base: '#e98b9a', variation: 0.03 }, grain: { strength: 0.2, size: 2 }, fibers: { density: 30, length: 8, width: 0.6, opacity: 0.25, lightColor: '#ffffff', darkRatio: 0 }, lighting: { depth: 0.25 } },
  },
  'clear-tape': {
    preset: 'printer',
    params: { color: { base: '#ffffff', tint: '#ffffff', variation: 0 }, grain: { strength: 0 }, mottle: { relief: 0 }, fibers: { density: 0 }, specks: { density: 0 }, lighting: { depth: 0.1 } },
  },
  napkin: {
    preset: 'printer',
    params: {
      color: { base: '#fbfbf8', variation: 0.02 },
      grain: { size: 2, strength: 0.5, roughness: 0.6 },
      structure: { type: 'canvas', spacing: 7, strength: 0.35, sharpness: 0.2, warp: 0.5 },
      fibers: { density: 3, opacity: 0.12 },
      lighting: { depth: 0.55, elevation: 40 },
    },
  },
  thermal: {
    preset: 'printer',
    params: { color: { base: '#f3f2ee', tint: '#ece9e0', tintAmount: 0.4 }, grain: { strength: 0.12 }, fibers: { density: 0 }, lighting: { depth: 0.12 } },
  },
  // photo stock: resin-coated prints, instant-film frames, film base
  'photo-gloss': smooth('#f7f6f2'),
  'photo-matte': {
    preset: 'printer',
    params: { color: { base: '#f2efe7', tint: '#ece7da', variation: 0.03 }, grain: { strength: 0.3 }, fibers: { density: 1, opacity: 0.12 }, specks: { density: 0 }, lighting: { depth: 0.18 } },
  },
  polaroid: {
    preset: 'printer',
    params: { color: { base: '#f4f2ec', tint: '#eeebe2', variation: 0.02 }, grain: { strength: 0.38, size: 1.5 }, fibers: { density: 0 }, specks: { density: 0 }, lighting: { depth: 0.2 } },
  },
  film: {
    preset: 'printer',
    params: { color: { base: '#211a15', tint: '#2a1d14', variation: 0.04 }, grain: { strength: 0.12 }, fibers: { density: 0 }, specks: { density: 0 }, lighting: { depth: 0.12 } },
  },
  masking: {
    preset: 'kraft-light',
    params: {
      color: { base: '#e9dcbd', tint: '#e2d2ae', variation: 0.04 },
      // crepe: fine creases across the tape
      streaks: { length: 3, width: 40, strength: 0.55, direction: 'vertical' },
      fibers: { density: 4, opacity: 0.2 },
      specks: { density: 6 },
      grain: { strength: 0.25 },
      lighting: { depth: 0.45 },
    },
  },

  // desk surfaces
  cork: {
    preset: 'kraft',
    params: {
      color: { base: '#bf9468', tint: '#a97b52', tintAmount: 0.5, variation: 0.08, grainTone: 0.4 },
      grain: { size: 3, strength: 0.7, roughness: 0.65 },
      cells: { size: 6, strength: 0.6, ridge: 0.3, warp: 0.6 },
      fibers: { density: 0 },
      specks: { density: 900, sizeMin: 0.8, sizeMax: 3.2, elongation: 0.6, colors: ['#6b4426', '#8e6238', '#dcbd8f'], opacity: 0.75, relief: 0.4 },
      lighting: { depth: 0.8 },
    },
  },
  'cutting-mat': {
    preset: 'construction-green',
    params: { color: { base: '#2f5a4b', tint: '#2a5245' }, fibers: { density: 0 }, grain: { strength: 0.25 }, lighting: { depth: 0.2 } },
  },
  oak: wood('#b98b5b', '#9a6c40'),
  walnut: wood('#6a4630', '#4f3221'),
  plywood: wood('#d8b98d', '#c9a676', 0.15),
  steel: {
    preset: 'printer',
    params: {
      color: { base: '#c9cdd1', tint: '#b9bec4', tintAmount: 0.4, variation: 0.05, grainTone: 0.35 },
      grain: { strength: 0.12 },
      streaks: { length: 500, width: 1.2, strength: 0.7, direction: 'horizontal' },
      fibers: { density: 0 },
      specks: { density: 8, colors: ['#8a8f94', '#a0a4a8', '#e8eaec'], opacity: 0.4 },
      lighting: { depth: 0.25 },
    },
  },
  pegboard: {
    preset: 'kraft',
    params: { color: { base: '#c79f72', tint: '#b88d61', variation: 0.04 }, fibers: { density: 2 }, grain: { strength: 0.3 }, specks: { density: 30 }, lighting: { depth: 0.3 } },
  },
  concrete: {
    preset: 'printer',
    params: {
      color: { base: '#a3a19c', tint: '#8f8c86', tintAmount: 0.5, variation: 0.09, grainTone: 0.3 },
      mottle: { size: 260, relief: 0.2 },
      grain: { size: 3, strength: 0.7, roughness: 0.7 },
      fibers: { density: 0 },
      specks: { density: 700, sizeMin: 0.5, sizeMax: 2.2, elongation: 0.2, colors: ['#5d5b57', '#c8c6c0', '#7a7772'], opacity: 0.6, relief: -0.3 },
      lighting: { depth: 0.5 },
    },
  },
  felt: {
    preset: 'pastel-black',
    params: { color: { base: '#2c2b2e' }, fibers: { density: 40, length: 10, opacity: 0.35 }, lighting: { depth: 0.5 } },
  },
};

function wood(base: string, tint: string, figure = 0.14): PaperSpec {
  return {
    preset: 'printer',
    params: {
      color: { base, tint, tintAmount: 0.7, variation: 0.06, grainTone: 0.32 },
      mottle: { size: 700, warp: 0.6, relief: 0.04 },
      grain: { size: 2, strength: 0.1 },
      streaks: { length: 600, width: 2, strength: 1, direction: 'horizontal' },
      structure: { type: 'corrugated', spacing: 34, strength: figure, sharpness: 0.9, direction: 'horizontal', warp: 0.45 },
      fibers: { density: 0 },
      specks: { density: 260, sizeMin: 0.4, sizeMax: 1.1, elongation: 5, colors: [tint, tint, base], opacity: 0.7, relief: -0.25 },
      lighting: { depth: 0.3 },
    },
  };
}

export type PaperKey = keyof typeof paperStocks & string;

const paramCache = new Map<string, PaperParams>();
export function stockParams(key: string): PaperParams {
  let p = paramCache.get(key);
  if (!p) {
    const spec = paperStocks[key];
    p = buildParams(spec.preset, spec.params);
    paramCache.set(key, p);
  }
  return p;
}

export const paperBase = (key: string) => stockParams(key).color.base;
/** True for papers that need light ink. */
export const isDark = (key: string) => luminance(parseColor(paperBase(key))) < 0.45;
