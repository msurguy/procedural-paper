/**
 * Sheets: a finite piece of paper (not a repeating tile) with a real outline.
 * Torn / deckled / zigzag / scissor-cut edges, punched holes and binder rows,
 * sheet-scale relief (crumples, folds, curl, cockling) and a cast shadow, all
 * rendered with alpha. Lengths are CSS px; `pixelRatio` sets the resolution.
 */
import { parseColor, type RGB } from './color';
import { pcg } from './hash';
import type { PaperParams } from './params';

export type EdgeKind = 'straight' | 'torn' | 'deckle' | 'zigzag' | 'cut' | 'wavy';
export interface EdgeSpec {
  kind: EdgeKind;
  /** How far the edge bites into the sheet (px). */
  amount?: number;
  /** Feature length along the edge (px). */
  scale?: number;
}
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Corner = 'tl' | 'tr' | 'br' | 'bl';

export interface HoleSpec {
  x: number;
  y: number;
  r: number;
  /** Ragged outline, 0..1. */
  rough?: number;
}

/** A row of evenly spaced holes, e.g. spiral binding or a ticket perforation. */
export interface HoleRowSpec {
  x: number;
  y: number;
  dx: number;
  dy: number;
  count: number;
  r: number;
  /** Chance (0..1) that the paper between a hole and the nearest edge is torn out. */
  tear?: number;
  rough?: number;
}

export interface SheetSpec {
  /** CSS px. */
  width: number;
  height: number;
  /** Device pixels per CSS px (default 1). */
  pixelRatio?: number;
  /** Transparent border around the sheet for its shadow (CSS px; default fits the shadow). */
  margin?: number;
  /** Seed for edges, relief and holes (the paper itself uses `params.seed`). */
  seed?: number;
  shape?: {
    radius?: number;
    /** Cut-off top corners, like a shipping tag (px). */
    chamfer?: number;
    edges?: Partial<Record<Side, EdgeKind | EdgeSpec>>;
    /** Width of the pale fibrous rim on torn / deckled edges (px). */
    rim?: number;
    holes?: HoleSpec[];
    holeRows?: HoleRowSpec[];
  };
  relief?: {
    crumples?: number;
    crumpleSize?: number;
    wrinkles?: number;
    wrinkleSize?: number;
    folds?: { x?: number; y?: number; strength?: number; offset?: number; width?: number; wear?: number };
    /** Lifted corners / edges; `amount` is the lift in px. */
    curl?: { amount: number; radius?: number; corners?: Corner[]; sides?: Side[] };
    /** Low-frequency waviness of wet-then-dried paper. */
    cockle?: number;
    cockleSize?: number;
    /** Cylindrical bend (px of lift at the ends). */
    bend?: number;
    bendAngle?: number;
  };
  finish?: {
    /** < 1 for tracing paper, tape, vellum. */
    opacity?: number;
    gloss?: number;
    /** Darkened, handled edges. */
    edgeWear?: number;
    /** Yellowing that creeps in from the edges. */
    aging?: number;
    agingColor?: string;
    /** Printed pattern (washi tape, wrapping paper). Multiplied into the paper colour. */
    pattern?: { kind: 'stripes' | 'dots' | 'grid' | 'checker'; color: string; scale?: number; angle?: number; width?: number; opacity?: number };
  };
  shadow?: false | { strength?: number; softness?: number; offsetX?: number; offsetY?: number; lift?: number };
}

/**
 * color: lit sheet + shadow. base: sheet without sheet-scale shading (put ink on it).
 * shade: hard-light layer with that shading, for over the ink. shadow: only the
 * cast shadow (black, alpha); when requested, color and base omit the shadow so
 * it can be moved on its own (e.g. when the sheet is lifted).
 */
export type SheetOutput = 'color' | 'base' | 'shade' | 'shadow';

export const MAX_HOLES = 12;
export const MAX_HOLE_ROWS = 4;

const EDGE_KINDS: EdgeKind[] = ['straight', 'torn', 'deckle', 'zigzag', 'cut', 'wavy'];
const EDGE_DEFAULTS: Record<EdgeKind, [number, number]> = {
  straight: [0, 1],
  torn: [5, 26],
  deckle: [3, 14],
  zigzag: [4, 9],
  cut: [1.4, 40],
  wavy: [2, 30],
};
const PATTERNS = ['none', 'stripes', 'dots', 'grid', 'checker'];

export interface ResolvedSheet {
  /** Sheet size in device px. */
  width: number;
  height: number;
  margin: number;
  pixelRatio: number;
  seed: number;
  radius: number;
  chamfer: number;
  edgeKind: [number, number, number, number];
  edgeAmt: [number, number, number, number];
  edgeScale: [number, number, number, number];
  rim: number;
  holes: [number, number, number, number][];
  rowA: [number, number, number, number][];
  rowB: [number, number, number, number][];
  crumples: [number, number];
  wrinkles: [number, number];
  folds: { count: [number, number]; strength: number; offset: number; width: number; wear: number };
  curl: [number, number, number, number];
  cockle: [number, number];
  bend: [number, number];
  opacity: number;
  gloss: number;
  edgeWear: number;
  aging: number;
  agingColor: RGB;
  pattern: { kind: number; color: RGB; params: [number, number, number, number] };
  shadow: [number, number, number, number];
  shadowLift: number;
}

const CORNER_BITS: Record<Corner, number> = { tl: 1, tr: 2, br: 4, bl: 8 };
const SIDE_BITS: Record<Side, number> = { top: 1, right: 2, bottom: 4, left: 8 };

export function resolveSheet(spec: SheetSpec): ResolvedSheet {
  const k = spec.pixelRatio ?? 1;
  const shape = spec.shape ?? {};
  const rel = spec.relief ?? {};
  const fin = spec.finish ?? {};
  const sides: Side[] = ['top', 'right', 'bottom', 'left'];
  const edgeKind = [0, 0, 0, 0] as [number, number, number, number];
  const edgeAmt = [0, 0, 0, 0] as [number, number, number, number];
  const edgeScale = [1, 1, 1, 1] as [number, number, number, number];
  sides.forEach((s, i) => {
    const e = shape.edges?.[s];
    if (!e) return;
    const spec2: EdgeSpec = typeof e === 'string' ? { kind: e } : e;
    const [a, sc] = EDGE_DEFAULTS[spec2.kind];
    edgeKind[i] = Math.max(0, EDGE_KINDS.indexOf(spec2.kind));
    edgeAmt[i] = (spec2.amount ?? a) * k;
    edgeScale[i] = Math.max(1, (spec2.scale ?? sc) * k);
  });

  const sh = spec.shadow === false ? null : { strength: 1, softness: 5, offsetX: 1.5, offsetY: 4, lift: 0.1, ...spec.shadow };
  const curl = rel.curl;
  const maxLift = (curl?.amount ?? 0) + Math.abs(rel.bend ?? 0) + (rel.crumples ?? 0) * (rel.crumpleSize ?? 120) * 0.25;
  const autoMargin = sh
    ? Math.ceil(sh.softness * 2.2 + Math.max(Math.abs(sh.offsetX), Math.abs(sh.offsetY)) * (1 + sh.lift * maxLift) + 4)
    : 2;
  const margin = Math.ceil((spec.margin ?? autoMargin) * k);

  const holes = (shape.holes ?? []).slice(0, MAX_HOLES).map((h) => [h.x * k, h.y * k, h.r * k, h.rough ?? 0] as [number, number, number, number]);
  const rows = (shape.holeRows ?? []).slice(0, MAX_HOLE_ROWS);
  const pat = fin.pattern;
  const folds = rel.folds ?? {};
  const foldOn = (folds.strength ?? 1) > 0 && ((folds.x ?? 0) > 0 || (folds.y ?? 0) > 0);

  return {
    width: Math.max(1, Math.round(spec.width * k)),
    height: Math.max(1, Math.round(spec.height * k)),
    margin,
    pixelRatio: k,
    seed: pcg((spec.seed ?? 1) >>> 0),
    radius: (shape.radius ?? 0) * k,
    chamfer: (shape.chamfer ?? 0) * k,
    edgeKind,
    edgeAmt,
    edgeScale,
    rim: (shape.rim ?? 2.4) * k,
    holes,
    rowA: rows.map((r) => [r.x * k, r.y * k, r.dx * k, r.dy * k]),
    rowB: rows.map((r) => [r.count, r.r * k, r.tear ?? 0, r.rough ?? 0]),
    crumples: [(rel.crumples ?? 0) * (rel.crumpleSize ?? 120) * 0.25 * k, Math.max(4, (rel.crumpleSize ?? 120) * k)],
    wrinkles: [(rel.wrinkles ?? 0) * (rel.wrinkleSize ?? 24) * 0.25 * k, Math.max(2, (rel.wrinkleSize ?? 24) * k)],
    folds: {
      count: foldOn ? [Math.round(folds.x ?? 0), Math.round(folds.y ?? 0)] : [0, 0],
      strength: foldOn ? (folds.strength ?? 1) * 0.5 : 0,
      offset: folds.offset ?? 0,
      width: Math.max(1, (folds.width ?? 3) * k),
      wear: foldOn ? (folds.wear ?? 0.4) : 0,
    },
    curl: curl
      ? [
          curl.amount * k,
          Math.max(1, (curl.radius ?? 60) * k),
          (curl.corners ?? []).reduce((m, c) => m | CORNER_BITS[c], 0),
          (curl.sides ?? []).reduce((m, s) => m | SIDE_BITS[s], 0),
        ]
      : [0, 1, 0, 0],
    cockle: [(rel.cockle ?? 0) * k * 6, Math.max(4, (rel.cockleSize ?? 90) * k)],
    bend: [(rel.bend ?? 0) * k, ((rel.bendAngle ?? 0) * Math.PI) / 180],
    opacity: fin.opacity ?? 1,
    gloss: fin.gloss ?? 0,
    edgeWear: fin.edgeWear ?? 0,
    aging: fin.aging ?? 0,
    agingColor: parseColor(fin.agingColor ?? '#c9a66b'),
    pattern: {
      kind: pat ? Math.max(0, PATTERNS.indexOf(pat.kind)) : 0,
      color: parseColor(pat?.color ?? '#000000'),
      params: [Math.max(1, (pat?.scale ?? 10) * k), ((pat?.angle ?? 0) * Math.PI) / 180, pat?.width ?? 0.5, pat?.opacity ?? 1],
    },
    shadow: sh ? [sh.strength, Math.max(0.5, sh.softness * k), sh.offsetX * k, sh.offsetY * k] : [0, 1, 0, 0],
    shadowLift: sh ? sh.lift : 0,
  };
}

/**
 * Re-scale paper params for rendering at `k` device px per CSS px (or any zoom):
 * feature sizes grow by k, per-area densities shrink by k².
 */
export function scaleParams(p: PaperParams, k: number): PaperParams {
  return {
    ...p,
    scale: p.scale * k,
    fibers: { ...p.fibers, density: p.fibers.density / (k * k) },
    specks: { ...p.specks, density: p.specks.density / (k * k) },
  };
}
