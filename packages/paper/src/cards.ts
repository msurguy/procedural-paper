import { mergeParams, type DeepPartial, type PaperParams } from './params';
import { stockParams } from './stocks';
import type { EdgeSpec, SheetSpec } from './sheet';

export const cardPresetIds = ['sticky', 'index', 'notebook', 'napkin', 'scrap', 'graph', 'biz', 'quote', 'tag', 'receipt', 'ticket', 'memo', 'watercolor', 'clipping', 'stamp', 'tracing', 'tapelabel', 'polaroid', 'photonote', 'print', 'vintage', 'tear', 'album', 'booth', 'film'] as const;
export type CardPresetId = typeof cardPresetIds[number];
/** Region coordinates are CSS pixels, relative to the sheet's top-left corner. */
export interface CardRegion { x: number; y: number; width: number; height: number }
export interface CardPreset {
  id: CardPresetId;
  label: string;
  stock: string;
  width: number;
  height: number;
  sheet: Omit<SheetSpec, 'width' | 'height' | 'pixelRatio'>;
  regions: Record<string, CardRegion>;
  ruling?: 'index' | 'notebook' | 'grid';
}
const edge = (kind: EdgeSpec['kind'], amount: number, scale: number): EdgeSpec => ({ kind, amount, scale });
const allEdges = (e: EdgeSpec) => ({ top: e, right: e, bottom: e, left: e });
const torn = edge('torn', 5, 18), deckle = edge('deckle', 3, 12), zigzag = edge('zigzag', 3, 6);
const region = (x: number, y: number, width: number, height: number): CardRegion => ({ x, y, width, height });
const card = (id: CardPresetId, label: string, stock: string, width: number, height: number, sheet: CardPreset['sheet'] = {}, extras: Partial<Pick<CardPreset, 'regions' | 'ruling'>> = {}): CardPreset => ({
  id, label, stock, width, height, sheet, regions: { content: region(16, 16, width - 32, height - 32) }, ...extras,
});
/** Canonical paper styles from Paper Desk, without demo content or attachments. */
export const cardPresets: readonly CardPreset[] = [
  card('sticky', 'Sticky note', 'sticky', 196, 196, { relief: { curl: { amount: 8, radius: 75, corners: ['br'] } }, shadow: { lift: 0.22 } }),
  card('index', 'Index card', 'construction-white', 310, 190, { shape: { radius: 1 }, relief: { bend: 2 } }, { ruling: 'index', regions: { content: region(22, 41, 266, 137), title: region(18, 4, 274, 30) } }),
  card('notebook', 'Notebook page', 'drawing-pad', 255, 335, { shape: { edges: { left: torn }, holeRows: [{ x: 13, y: 11, dx: 0, dy: 22, count: 15, r: 4.6, tear: 0.3, rough: 0.5 }] }, relief: { curl: { amount: 4, corners: ['br'] } } }, { ruling: 'notebook', regions: { content: region(46, 33, 193, 288) } }),
  card('napkin', 'Napkin', 'napkin', 250, 250, { shape: { edges: allEdges(edge('deckle', 1.4, 8)), rim: 1.2 }, relief: { folds: { x: 2, y: 2, strength: 1, wear: 0.15 }, crumples: 0.12, wrinkles: 0.08 } }),
  card('scrap', 'Torn scrap', 'kraft-light', 190, 145, { shape: { edges: allEdges(torn), rim: 2.6 }, relief: { crumples: 0.12, wrinkles: 0.06 } }),
  card('graph', 'Graph paper', 'printer', 260, 280, { shape: { edges: { bottom: torn } } }, { ruling: 'grid' }),
  card('biz', 'Business card', 'handmade-ivory', 260, 150, { shape: { radius: 2 }, relief: { bend: 1 } }),
  card('quote', 'Quote card', 'handmade-navy', 250, 165, { relief: { bend: 2 }, shadow: { softness: 4.5 } }),
  card('tag', 'Shipping tag', 'kraft', 140, 255, { shape: { chamfer: 24, holes: [{ x: 70, y: 28, r: 6 }] }, relief: { bend: 2, bendAngle: 90 }, finish: { edgeWear: 0.4 } }, { regions: { content: region(12, 58, 116, 173) } }),
  card('receipt', 'Receipt', 'thermal', 192, 300, { shape: { edges: { top: zigzag, bottom: zigzag } }, relief: { bend: 6, crumples: 0.1, crumpleSize: 90, wrinkles: 0.05 }, finish: { gloss: 0.06 } }),
  card('ticket', 'Ticket stub', 'construction-yellow', 265, 108, { shape: { holes: [{ x: 0, y: 54, r: 9 }, { x: 265, y: 54, r: 9 }], holeRows: [{ x: 191, y: 5, dx: 0, dy: 6.5, count: 16, r: 1.3 }] }, relief: { bend: 2 } }, { regions: { content: region(18, 14, 161, 80), stub: region(199, 14, 50, 80) } }),
  card('memo', 'Typed letter', 'sketchbook-cream', 285, 360, { relief: { folds: { y: 3, strength: 1, wear: 0.35 } }, finish: { aging: 0.2 } }, { regions: { content: region(26, 26, 233, 250), signature: region(40, 294, 205, 40) } }),
  card('watercolor', 'Watercolor swatch', 'watercolor-cold-press', 220, 250, { shape: { edges: allEdges(deckle) }, relief: { cockle: 0.4 } }),
  card('clipping', 'Newspaper clipping', 'newsprint-old', 235, 295, { shape: { edges: allEdges(edge('cut', 2, 40)) }, relief: { folds: { x: 2, strength: 0.6 }, curl: { amount: 3, sides: ['right'] } }, finish: { aging: 0.4, edgeWear: 0.4 } }),
  card('stamp', 'Postage stamp', 'printer', 80, 96, { shape: { holeRows: [{ x: 0, y: 0, dx: 8, dy: 0, count: 11, r: 2 }, { x: 0, y: 96, dx: 8, dy: 0, count: 11, r: 2 }, { x: 0, y: 0, dx: 0, dy: 8, count: 13, r: 2 }, { x: 80, y: 0, dx: 0, dy: 8, count: 13, r: 2 }] } }, { regions: { content: region(8, 8, 64, 80) } }),
  card('tracing', 'Tracing paper', 'tracing', 250, 280, { finish: { opacity: 0.65 }, relief: { wrinkles: 0.08 } }),
  card('tapelabel', 'Tape label', 'masking', 220, 64, { shape: { edges: { left: torn, right: torn } }, finish: { opacity: 0.94 }, shadow: { softness: 1, offsetY: 1 } }, { regions: { content: region(12, 8, 196, 48) } }),
  card('polaroid', 'Instant photo', 'polaroid', 220, 270, { shape: { radius: 2 }, relief: { bend: 2 }, finish: { gloss: 0.12 } }, { regions: { photo: region(14, 14, 192, 192), content: region(14, 214, 192, 42) } }),
  card('photonote', 'Photo note', 'sketchbook-cream', 260, 320, { relief: { bend: 2 } }, { regions: { photo: region(18, 18, 224, 180), content: region(18, 214, 224, 88) } }),
  card('print', 'Rounded print', 'photo-gloss', 240, 180, { shape: { radius: 11 }, relief: { bend: 2 }, finish: { gloss: 0.45 } }, { regions: { content: region(0, 0, 240, 180) } }),
  card('vintage', 'Vintage print', 'photo-matte', 220, 240, { shape: { edges: allEdges(edge('wavy', 1.3, 5.5)), rim: 0 }, relief: { cockle: 0.2 }, finish: { aging: 0.4, edgeWear: 0.5, gloss: 0.05 } }, { regions: { photo: region(12, 12, 196, 184), content: region(12, 206, 196, 22) } }),
  card('tear', 'Magazine tear', 'photo-gloss', 230, 260, { shape: { edges: { top: torn, right: torn, bottom: torn }, rim: 2.8 }, relief: { cockle: 0.4 }, finish: { gloss: 0.15 } }, { regions: { photo: region(0, 0, 230, 194), content: region(16, 202, 198, 42) } }),
  card('album', 'Album page', 'construction-black', 300, 370, { shape: { radius: 1 }, relief: { bend: 2, bendAngle: 90 } }, { regions: { photo1: region(20, 20, 150, 145), photo2: region(20, 200, 150, 145), content: region(182, 20, 98, 145), caption2: region(182, 200, 98, 145) } }),
  card('booth', 'Photo-booth strip', 'photo-matte', 100, 310, { shape: { radius: 0.8 }, relief: { bend: 4, bendAngle: 90 }, finish: { gloss: 0.15 } }, { regions: { photo1: region(8, 8, 84, 64), photo2: region(8, 78, 84, 64), photo3: region(8, 148, 84, 64), photo4: region(8, 218, 84, 64), content: region(8, 286, 84, 16) } }),
  card('film', 'Film strip', 'film', 348, 112, { shape: { holeRows: [{ x: 7, y: 7, dx: 14, dy: 0, count: 25, r: 2.8 }, { x: 7, y: 105, dx: 14, dy: 0, count: 25, r: 2.8 }] }, relief: { bend: 2 }, finish: { opacity: 0.95, gloss: 0.55 } }, { regions: { photo1: region(10, 21, 104, 70), photo2: region(122, 21, 104, 70), photo3: region(234, 21, 104, 70), content: region(10, 93, 328, 12) } }),
];
export interface CardOptions {
  preset: CardPresetId;
  width?: number;
  height?: number;
  seed?: number;
  params?: DeepPartial<PaperParams>;
  /** Top-level sheet groups replace their preset counterparts. */
  sheet?: Omit<SheetSpec, 'width' | 'height'>;
}
export function getCardPreset(id: CardPresetId): CardPreset {
  const preset = cardPresets.find(p => p.id === id);
  if (!preset) throw new Error(`procedural-paper: unknown card preset "${id}"`);
  return structuredClone(preset);
}
/** Scale the preset's geometry and regions to explicit CSS dimensions. */
export function resolveCard(options: CardOptions) {
  const preset = getCardPreset(options.preset);
  const width = options.width ?? preset.width, height = options.height ?? preset.height;
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Paper dimensions must be positive finite numbers');
  const sx = width / preset.width, sy = height / preset.height;
  const shape = preset.sheet.shape;
  if (shape) {
    if (shape.chamfer) shape.chamfer *= Math.min(sx, sy);
    shape.holes?.forEach(h => { h.x *= sx; h.y *= sy; });
    shape.holeRows?.forEach(h => { h.x *= sx; h.y *= sy; h.dx *= sx; h.dy *= sy; });
  }
  const regions = Object.fromEntries(Object.entries(preset.regions).map(([name, r]) => [name, region(r.x * sx, r.y * sy, r.width * sx, r.height * sy)]));
  return { preset, regions, params: mergeParams(stockParams(preset.stock), options.params, options.seed === undefined ? undefined : { seed: options.seed }), sheet: { ...preset.sheet, seed: options.seed ?? 1, ...options.sheet, width, height } as SheetSpec };
}
