/**
 * Fit card text to its box with @chenglou/pretext: text is measured once per
 * block (canvas, real font), then line counts at any size come from pure
 * arithmetic, so we can binary-search the largest size that fits without
 * touching the DOM. On ruled paper the line pitch is fixed, so we shrink a
 * little and then drop trailing items instead.
 */
import { layout, prepare, type PreparedText } from '@chenglou/pretext';
export interface Font { family: string; size: number; kind: 'hand' | 'mono'; marker?: boolean; weight?: string }

export interface FitBlock {
  /** Plain text used for measuring (and rendering, unless `html` is given). */
  text: string;
  /** Rendered markup when it differs from `text` (e.g. typewriter spans). */
  html?: string;
  /** Size relative to the block's base size (em). */
  scale?: number;
  /** Extra space above the block (em of its own size). */
  gap?: number;
  /** Letter-spacing in em. */
  spacing?: number;
  cls?: string;
  /** Font weight for this block (defaults to the spec's). */
  weight?: string;
  /** Only the first block is kept... unless this is set (titles, signatures stay). */
  keep?: boolean;
}

export interface FitSpec {
  font: Font;
  weight?: string;
  /** Box in px. */
  width: number;
  height: number;
  /** Largest / smallest font size in px (final, after the font's own size factor). */
  max: number;
  min: number;
  /** Line height as a multiple of the font size... */
  lineHeight?: number;
  /** ...or a fixed pitch in px (ruled paper). */
  pitch?: number;
  whiteSpace?: 'normal' | 'pre-wrap';
  /** Drop trailing blocks when even `min` doesn't fit (default true). */
  drop?: boolean;
  /** Never wrap past this many lines (labels, one-liners). */
  maxLines?: number;
  /** Vertical writing mode: width/height describe the inline/block axes. */
  vertical?: boolean;
  blocks: FitBlock[];
}

export interface FitResult {
  size: number;
  kept: number;
  lines: number;
}

const REF = 100;
const loaded = new Map<string, Promise<unknown>>();
const prepared = new Map<string, PreparedText>();

function fontString(f: Font, weight: string, px: number) {
  return `${weight} ${px}px "${f.family}"`;
}

function ensureFont(f: Font, weight: string) {
  const key = `${weight} ${f.family}`;
  let p = loaded.get(key);
  if (!p) {
    p = document.fonts.load(fontString(f, weight, 20), 'abc ☐☑').catch(() => undefined);
    loaded.set(key, p);
  }
  return p;
}

function prep(text: string, f: Font, weight: string, spacingEm: number, ws: 'normal' | 'pre-wrap') {
  const key = `${f.family}|${weight}|${spacingEm}|${ws}|${text}`;
  let p = prepared.get(key);
  if (!p) {
    p = prepare(text, fontString(f, weight, REF), { whiteSpace: ws, letterSpacing: spacingEm * REF });
    prepared.set(key, p);
  }
  return p;
}

/** Text widths scale linearly with size, so measure once at 100px and rescale the box. */
function measure(spec: FitSpec, size: number, count: number) {
  const weight = spec.weight ?? '400';
  const ws = spec.whiteSpace ?? 'normal';
  let h = 0, lines = 0;
  for (let i = 0; i < count; i++) {
    const b = spec.blocks[i];
    const s = size * (b.scale ?? 1);
    const p = prep(b.text, spec.font, b.weight ?? weight, b.spacing ?? 0, ws);
    const n = b.text ? layout(p, (spec.width * REF) / s, 1).lineCount : 1;
    const lh = spec.pitch ?? s * (spec.lineHeight ?? 1.2);
    h += n * lh + (b.gap ?? 0) * s;
    lines += n;
  }
  return { h, lines };
}

export async function fitText(spec: FitSpec): Promise<FitResult> {
  await Promise.all([spec.weight ?? '400', ...spec.blocks.map((b) => b.weight).filter(Boolean)].map((w) => ensureFont(spec.font, w!)));
  const fits = (size: number, count: number) => {
    const m = measure(spec, size, count);
    return m.h <= spec.height + 0.5 && (spec.maxLines === undefined || m.lines <= spec.maxLines);
  };
  let count = spec.blocks.length;
  // drop trailing optional blocks until the text fits at the minimum size
  if (spec.drop !== false) {
    while (count > 1 && !fits(spec.min, count)) {
      let i = count - 1;
      while (i > 0 && spec.blocks[i].keep) i--;
      if (i === 0) break;
      spec.blocks.splice(i, 1);
      count--;
    }
  }
  let lo = spec.min, hi = spec.max;
  if (fits(hi, count)) lo = hi;
  else
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, count)) lo = mid;
      else hi = mid;
    }
  const size = Math.floor(lo * 4) / 4;
  return { size, kept: count, lines: measure(spec, size, count).lines };
}

// ---------------------------------------------------------------- DOM glue

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
export const fitSpecs = new WeakMap<HTMLElement, FitSpec>();
const jobs = new WeakMap<HTMLElement, FitSpec>();

export function blocksHTML(blocks: FitBlock[]) {
  return blocks
    .map((b) => {
      const st = [b.scale && b.scale !== 1 ? `font-size:${b.scale}em` : '', b.gap ? `margin-top:${b.gap}em` : '', b.spacing ? `letter-spacing:${b.spacing}em` : '', b.weight ? `font-weight:${b.weight}` : ''].filter(Boolean).join(';');
      return `<div class="${b.cls ?? ''}"${st ? ` style="${st}"` : ''}>${b.html ?? esc(b.text)}</div>`;
    })
    .join('');
}

/** Register `el` to be fitted before its card is shown; renders at max size for now. */
export function fitLater(el: HTMLElement, spec: FitSpec) {
  el.innerHTML = blocksHTML(spec.blocks);
  el.style.fontSize = `${spec.max}px`;
  if (spec.pitch) el.style.lineHeight = `${spec.pitch}px`;
  else el.style.lineHeight = `${spec.lineHeight ?? 1.2}`;
  el.style.width = `${spec.vertical ? spec.height : spec.width}px`;
  el.style.height = `${spec.vertical ? spec.width : spec.height}px`;
  el.classList.add('fit');
  jobs.set(el, spec);
  fitSpecs.set(el, spec);
}

/** Fit every registered text block inside `root`. */
export async function runFits(root: HTMLElement) {
  const els = [root, ...root.querySelectorAll<HTMLElement>('.fit')].filter((e) => jobs.has(e));
  for (const el of els) {
    const spec = jobs.get(el)!;
    const before = spec.blocks.length;
    const r = await fitText(spec);
    el.innerHTML = blocksHTML(spec.blocks.slice(0, r.kept));
    el.style.fontSize = `${r.size}px`;
    el.dataset.fit = `${r.size}px, ${r.lines} lines${r.kept < before ? `, dropped ${before - r.kept}` : ''}`;
    jobs.delete(el);
  }
}
