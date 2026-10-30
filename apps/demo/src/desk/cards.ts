import { getCardPreset, type CardPresetId } from 'procedural-paper';
/**
 * Card kinds. A maker returns a *plan*: the paper, the sheet (outline, holes,
 * relief, finish), the ink (DOM, in card-local CSS px) and its attachments
 * (pins, clips, tape...). render.ts turns a plan into pixels.
 */
import { parseColor, toHex, type DeepPartial, type PaperParams, type SheetSpec } from 'procedural-paper';
import { BODY, CAMERA_STAMPS, DATES, EVENTS, FILM_STOCKS, HEADLINES, ITEMS, LABELS, NAMES, NOTES, PAINTS, PHOTO_CAPTIONS, PHOTO_DATES, QUOTES, ROLES, SHOPS, STUDIOS, TITLES, TODOS } from './content';
import { blobPath, sketchSVG } from './doodles';
import { css, HAND, MONO, PEN, RECEIPT, TYPEWRITER, type Font } from './fonts';
import { fitLater, type FitBlock, type FitSpec } from './fit';
import { isDark } from './papers';
import { tagCord, type CordSpec } from './cords';
import type { PropSpec } from './props';
import { bounds, cornerOf, freeRect, layoutNote, photoLater, pickPhoto, PHOTOS, type Box, type Grade, type NoteLayout, type PhotoMeta, type PhotoSpec, type Placed } from './photos';
import type { Rng } from './rng';
import { bracketQuote, circleWord, developPhoto, drawDoodle, fadeIn, highlightLine, mark, markFrame, motion, riseIn, stampIn, strikeDone, typeIn, underlineTitle, writeOn, type MotionSpec } from './motion-spec';

export type Mood = 'mix' | 'hand' | 'mono';
/** How things are attached on this desk surface. */
export type Mount = 'board' | 'magnetic' | 'table';

export interface Ctx {
  rng: Rng;
  mood: Mood;
  mount: Mount;
  /** Chance that a card gets an attachment. */
  attachRate: number;
  /** Chance that a card's content animates (0 = motion off). */
  motion: number;
  /** Pen font (handwriting.ts) that replaces every handwritten face, to try one stroke font across the desk. */
  pen?: Font;
}

export interface CardInfo {
  kind: string;
  paper: string;
  fonts: string[];
  attachments: string[];
}

export type SheetLook = Omit<SheetSpec, 'width' | 'height' | 'pixelRatio'>;

export type Attach = (
  | { type: 'prop'; x: number; y: number; layer: 'front' | 'back'; prop: PropSpec; label: string }
  | {
      type: 'sheet';
      x: number;
      y: number;
      w: number;
      h: number;
      angle: number;
      layer: 'front' | 'back';
      paper: string;
      params?: DeepPartial<PaperParams>;
      look: SheetLook;
      label: string;
    }
  | { type: 'html'; layer: 'front' | 'back'; el: HTMLElement; label?: string }
  /** A string / ribbon; renders its on-top strands in front of the sheet and the tucked-under parts behind. */
  | { type: 'cord'; spec: CordSpec; label: string }
  /** A photo print: a small sheet with a graded photo in its `window` (print px), centred at (cx, cy). */
  | {
      type: 'photo';
      cx: number;
      cy: number;
      w: number;
      h: number;
      angle: number;
      layer: 'front' | 'back';
      paper: string;
      params?: DeepPartial<PaperParams>;
      look: SheetLook;
      photo: PhotoSpec;
      window: Box;
      label: string;
    }
) & {
  /** Only joins two things on the card (a photo taped onto a note): not how the card itself is held. */
  binds?: boolean;
};

export interface CardPlan {
  preset?: CardPresetId;
  w: number;
  h: number;
  rot: number;
  paper: string;
  params?: DeepPartial<PaperParams>;
  look: SheetLook;
  /** Ink, rulings and print, positioned in card-local px. Null for blank paper. */
  ink: HTMLElement | null;
  attach: Attach[];
  info: CardInfo;
  /** How the ink animates once the card is on the desk (motion.ts). */
  motion?: MotionSpec;
}

type Pt = [number, number];

// ---------------------------------------------------------------- helpers

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const INKS = { ballpoint: '#22337f', black: '#1f1e24', graphite: '#4d4b48', red: '#b1272d', green: '#2d6640', sepia: '#5b3b23', violet: '#4b2f7a' };
const CHALK = ['#f3efe6', '#f0d27a', '#dce8f3', '#f6c9c9'];

function inkFor(rng: Rng, paper: string, prefer?: (keyof typeof INKS)[]): string {
  if (isDark(paper)) return rng.pick(CHALK);
  const pool = prefer ?? (['ballpoint', 'black', 'graphite', 'black', 'ballpoint', 'red', 'green', 'sepia', 'violet'] as const);
  return INKS[rng.pick(pool)];
}

/** Font for a text role. `flex` roles follow the global mood; fixed roles don't. */
function font(ctx: Ctx, natural: Font[], flex = true): Font {
  const f = flex && ctx.mood === 'hand' ? ctx.rng.pick(PEN) : flex && ctx.mood === 'mono' ? ctx.rng.pick(MONO) : ctx.rng.pick(natural);
  return penned(ctx, f);
}

/** The desk-wide pen font in place of a handwritten face (swapped after picking, so the rng sequence and the desk stay the same). */
const penned = (ctx: Ctx, f: Font): Font => (ctx.pen && f.kind === 'hand' ? ctx.pen : f);

export function mix(a: string, b: string, t: number) {
  const x = parseColor(a), y = parseColor(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function div(cls: string, style = '', html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (style) d.style.cssText = style;
  if (html) d.innerHTML = html;
  return d;
}

function ink(fontF: Font, px: number, color: string, style = '', html = '', cls = ''): HTMLDivElement {
  const p = parseColor(color);
  const light = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] > 0.55;
  return div(`ink ${light ? 'light' : ''} ${cls}`, `${css(fontF, px)};color:${color};${style}`, html);
}

/**
 * Ink that is fitted to a box (x, y, w, h in card px) before the card is shown:
 * the largest size up to `px` that fits, smaller if needed, dropping trailing
 * list items as a last resort. See fit.ts.
 */
function fitInk(
  f: Font,
  px: number,
  color: string,
  box: { x: number; y: number; w: number; h: number },
  blocks: FitBlock[],
  opts: Partial<FitSpec> = {},
  style = '',
  cls = '',
): HTMLDivElement {
  const el = ink(f, px, color, `left:${box.x}px;top:${box.y}px;${style}`, '', cls);
  const max = px * f.size;
  fitLater(el, { font: f, width: box.w, height: box.h, max, min: Math.max(8, max * 0.55), blocks, ...opts });
  return el;
}

const todo = (t: string, done: boolean, extra = ''): FitBlock => ({ text: `${done ? '☑' : '☐'} ${t}`, cls: done ? 'done' + extra : '' });

/** Typewriter text: per-glyph ink density and baseline jitter. */
function typed(rng: Rng, text: string): string {
  return text
    .split(/(\s+)/)
    .map((word) =>
      /\s/.test(word)
        ? word
        : `<span class="w">${[...word]
            .map((ch) => {
              const o = rng.chance(0.08) ? rng.range(0.45, 0.65) : rng.range(0.78, 1);
              const y = rng.range(-0.5, 0.5);
              return `<span style="opacity:${o.toFixed(2)};top:${y.toFixed(1)}px">${esc(ch)}</span>`;
            })
            .join('')}</span>`,
    )
    .join('');
}

function coffeeRing(rng: Rng, layer: HTMLElement, w: number, h: number) {
  const r = rng.range(30, 46);
  const cx = rng.range(0.15, 0.85) * w, cy = rng.range(0.15, 0.85) * h;
  const gap = rng.range(0, 360);
  const svg = `<svg width="${r * 2 + 20}" height="${r * 2 + 20}" style="filter:url(#f-stain)"><circle cx="${r + 10}" cy="${r + 10}" r="${r}" fill="rgba(140,90,40,0.06)" stroke="rgba(120,72,30,0.3)" stroke-width="${rng.range(1.5, 3)}" stroke-dasharray="${r * 5.4} ${r * 0.9}" transform="rotate(${gap} ${r + 10} ${r + 10})"/></svg>`;
  layer.appendChild(div('stain', `left:${cx - r - 10}px;top:${cy - r - 10}px`, svg));
}

function barcode(rng: Rng, w: number, h: number): string {
  let x = 0;
  const stops: string[] = [];
  while (x < w) {
    const bw = rng.pick([1, 1, 2, 3]);
    stops.push(`#222 ${x}px ${x + bw}px`, `transparent ${x + bw}px ${x + bw + rng.pick([1, 2, 2, 3])}px`);
    x += bw + 3;
  }
  return `<div class="barcode" style="width:${w}px;height:${h}px;background:linear-gradient(90deg, ${stops.join(',')})"></div>`;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1).replace(/[.!?]+$/, '');
const trim = (s: string) => s.replace(/[.!?]+$/, '');
const fmtMoney = (n: number) => n.toFixed(2);
const shuffled = <T,>(rng: Rng, a: readonly T[]) => [...a].sort(() => rng() - 0.5);

const torn = (amount?: number, scale?: number) => ({ kind: 'torn' as const, amount, scale });

// ---------------------------------------------------------------- attachments

const PIN_COLORS = ['#d23a3a', '#2f6fd6', '#f2c230', '#2fa36b', '#f0f0ee', '#1d1d22', '#e2672e', '#8e4fc4'];
const MAGNET_COLORS = ['#d23a3a', '#2f6fd6', '#f2c230', '#2fa36b', '#f2f0ea', '#1d1d22', '#ef8fb0'];
const WASHI = ['#e98b9a', '#8fc3e0', '#f2d27a', '#a9d3b0', '#c7b3e3', '#f3b48b', '#d8d0c4'];

export type TapeStyle = 'masking' | 'washi' | 'clear' | 'kraft';

export function tapeSheet(rng: Rng, x: number, y: number, len: number, angle: number, style: TapeStyle = rng.pick(['masking', 'masking', 'washi', 'clear', 'kraft'] as const)): Attach {
  const h = style === 'washi' ? rng.range(15, 20) : style === 'kraft' ? rng.range(22, 26) : rng.range(19, 24);
  const ends = style === 'clear' ? { kind: 'zigzag' as const, amount: 1.6, scale: 2.6 } : torn(style === 'washi' ? 1.6 : 2.4, 3.5);
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { edges: { left: ends, right: ends }, rim: style === 'clear' ? 0 : 0.8 },
    finish:
      style === 'clear'
        ? { opacity: 0.16, gloss: 0.9 }
        : style === 'washi'
          ? {
              opacity: 0.8,
              pattern: {
                kind: rng.pick(['stripes', 'dots', 'grid', 'checker'] as const),
                color: mix(rng.pick(WASHI), '#000000', 0.1),
                scale: rng.range(5, 10),
                angle: rng.pick([0, 45, 90, -30]),
                width: rng.range(0.35, 0.6),
                opacity: 0.85,
              },
            }
          : { opacity: style === 'kraft' ? 1 : 0.9, gloss: style === 'kraft' ? 0.15 : 0.02 },
    relief: { wrinkles: rng.range(0, 0.25), wrinkleSize: 10 },
    shadow: { strength: style === 'clear' ? 0.35 : 0.55, softness: 1.4, offsetX: 0.5, offsetY: 1.2, lift: 0 },
  };
  const paper = style === 'clear' ? 'clear-tape' : style === 'washi' ? 'washi' : style === 'kraft' ? 'kraft' : 'masking';
  const params: DeepPartial<PaperParams> | undefined = style === 'washi' ? { color: { base: rng.pick(WASHI) } } : undefined;
  return { type: 'sheet', x, y, w: len, h, angle, layer: 'front', paper, params, look, label: `${style} tape` };
}

/** Pick attachments for a card of size w x h on the given desk surface. */
function attachments(ctx: Ctx, w: number, h: number, opts: { allowTape?: boolean; allowClip?: boolean } = {}): Attach[] {
  const { rng } = ctx;
  if (!rng.chance(ctx.attachRate)) return [];
  const out: Attach[] = [];
  const pin = (x: number, y: number, kind: PropSpec['kind'] = 'pushpin', color = rng.pick(PIN_COLORS)) =>
    out.push({ type: 'prop', x, y, layer: 'front', prop: { kind, color, angle: rng.range(0, 360) }, label: kind === 'mappin' ? 'map pin' : 'push pin' });
  const options: [string, number][] =
    ctx.mount === 'board'
      ? [['pin', 4], ['pins2', 2], ['tacks', 2], ['mappin', 1.5], ['tape', 1.5], ['clip', 1], ['binder', 0.6]]
      : ctx.mount === 'magnetic'
        ? [['magnet', 4], ['magnets2', 2], ['neo', 1.5], ['bar', 1], ['tape', 1], ['binder', 0.8]]
        : [['tape', 4], ['tapes2', 2], ['clip', 2], ['binder', 1.2], ['staple', 1], ['magnet', 0.3]];
  const allowed = options.filter(([k]) => (opts.allowTape !== false || !k.startsWith('tape')) && (opts.allowClip !== false || (k !== 'clip' && k !== 'binder')));
  if (!allowed.length) return [];
  const choice = rng.weighted(allowed, ([, wt]) => wt)[0];
  const cx = w / 2 + rng.range(-w * 0.15, w * 0.15);
  switch (choice) {
    case 'pin':
      pin(cx, rng.range(10, 16));
      break;
    case 'pins2': {
      const c = rng.pick(PIN_COLORS);
      pin(rng.range(12, 18), rng.range(12, 18), 'pushpin', c);
      pin(w - rng.range(12, 18), rng.range(12, 18), 'pushpin', c);
      break;
    }
    case 'tacks': {
      const c = rng.pick(['#d9b45a', '#cfd3d8']);
      for (const [x, y] of [[10, 10], [w - 10, 10], [w - 10, h - 10], [10, h - 10]] as Pt[])
        out.push({ type: 'prop', x: x + rng.range(-2, 2), y: y + rng.range(-2, 2), layer: 'front', prop: { kind: 'thumbtack', color: c, angle: rng.range(0, 360) }, label: 'thumbtack' });
      break;
    }
    case 'mappin':
      pin(rng.chance(0.5) ? rng.range(10, 20) : w - rng.range(10, 20), rng.range(10, 20), 'mappin');
      break;
    case 'magnet':
    case 'magnets2': {
      const c = rng.pick(MAGNET_COLORS);
      out.push({ type: 'prop', x: choice === 'magnet' ? cx : rng.range(14, 22), y: rng.range(12, 20), layer: 'front', prop: { kind: 'magnet', color: c }, label: 'magnet' });
      if (choice === 'magnets2') out.push({ type: 'prop', x: w - rng.range(14, 22), y: h - rng.range(14, 22), layer: 'front', prop: { kind: 'magnet', color: c }, label: 'magnet' });
      break;
    }
    case 'neo':
      out.push({ type: 'prop', x: cx, y: rng.range(8, 14), layer: 'front', prop: { kind: 'magnet-neo' }, label: 'neodymium magnet' });
      break;
    case 'bar':
      out.push({ type: 'prop', x: cx, y: rng.range(10, 14), layer: 'front', prop: { kind: 'magnet-bar', color: rng.pick(MAGNET_COLORS), angle: rng.range(-8, 8) }, label: 'bar magnet' });
      break;
    case 'tape':
      out.push(tapeSheet(rng, cx, rng.range(-1, 4), rng.range(70, 100), rng.range(-9, 9)));
      break;
    case 'tapes2': {
      const style = rng.pick(['masking', 'washi', 'clear'] as const);
      out.push(tapeSheet(rng, 6, 6, rng.range(56, 72), -45 + rng.range(-8, 8), style));
      out.push(tapeSheet(rng, w - 6, h - 6, rng.range(56, 72), -45 + rng.range(-8, 8), style));
      break;
    }
    case 'clip': {
      const x = rng.range(w * 0.15, w * 0.85);
      const a = rng.range(-6, 6);
      const color = rng.pick(['#cfd3d8', '#cfd3d8', '#d24a4a', '#3a6fd2', '#e9c03a']);
      out.push({ type: 'prop', x, y: 4, layer: 'back', prop: { kind: 'paperclip', color, angle: a, part: 'back' }, label: 'paper clip' });
      out.push({ type: 'prop', x, y: 4, layer: 'front', prop: { kind: 'paperclip', color, angle: a, part: 'front' }, label: '' });
      break;
    }
    case 'binder':
      out.push({ type: 'prop', x: rng.range(w * 0.3, w * 0.7), y: 8, layer: 'front', prop: { kind: 'binder', color: rng.pick(['#1d1d22', '#1d1d22', '#c23b3b', '#2d5bb8']) }, label: 'binder clip' });
      break;
    case 'staple':
      out.push({ type: 'prop', x: 14, y: 14, layer: 'front', prop: { kind: 'staple', angle: -45 + rng.range(-10, 10) }, label: 'staple' });
      break;
  }
  return out;
}

const info = (kind: string, paper: string, fonts: string[], attach: Attach[]): CardInfo => ({
  kind,
  paper,
  fonts,
  attachments: attach.map((a) => (a.type === 'html' ? a.label ?? '' : a.label)).filter(Boolean),
});

// ---------------------------------------------------------------- kinds

type Maker = (ctx: Ctx) => CardPlan;

const STICKY = ['#f8e47e', '#f8e47e', '#f6b7c9', '#c2e8cb', '#aed6f0', '#f9c58c', '#d6c8f2'];

const sticky: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const s = rng.int(176, 214);
  const color = rng.pick(STICKY);
  const layer = div('layer');
  layer.appendChild(div('adhesive'));
  const mode = rng.int(0, 2);
  const f = font(ctx, mode === 2 ? HAND : PEN);
  const inkColor = INKS[rng.pick(['ballpoint', 'black', 'black', 'red', 'graphite'] as const)];
  let blocks: FitBlock[];
  // with motion the title underline and the strike-throughs are brushed on instead of CSS-decorated
  const deco = mo ? ' nodeco' : '';
  if (mode === 0) blocks = [{ text: rng.pick(TITLES), cls: 't' + deco, keep: true }, { text: rng.pick(NOTES) }];
  else if (mode === 1) blocks = [{ text: rng.pick(TITLES), cls: 't' + deco, keep: true }, ...shuffled(rng, TODOS).slice(0, rng.int(3, 4)).map((t) => todo(t, rng.chance(0.35), deco))];
  else blocks = [{ text: rng.pick(NOTES) }];
  layer.appendChild(fitInk(f, mode === 2 ? 30 : mode === 0 ? 25 : 21, inkColor, { x: 16, y: 22, w: s - 32, h: s - 36 }, blocks, { lineHeight: 1.15 }));
  const corner = rng.pick(['br', 'bl'] as const);
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    relief: { curl: { amount: rng.range(5, 12), radius: rng.range(60, 95), corners: [corner] }, bend: rng.range(-2, 3) },
    shadow: { lift: 0.22 },
  };
  const attach = ctx.mount === 'board' && rng.chance(0.3) ? attachments({ ...ctx, attachRate: 1 }, s, s, { allowClip: false }) : [];
  const spec = motion(mo && mode !== 2, [...underlineTitle(m, '.t', inkColor), ...(mode === 1 ? strikeDone(m, '.done', inkColor) : [])]);
  return { w: s, h: s, rot: rng.range(-6, 6), paper: 'sticky', params: { color: { base: color, tint: color } }, look, ink: layer, attach, info: info('Sticky note', 'sticky', [f.family], attach), motion: spec };
};

const indexCard: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const vertical = rng.chance(0.2);
  const w = vertical ? 190 : 310, h = vertical ? 310 : 190;
  const key = rng.pick(['construction-white', 'printer', 'pastel-light-cream', 'handmade-ivory']);
  const layer = div('layer');
  const lined = rng.chance(0.75);
  if (lined) layer.appendChild(div('rules index'));
  const f = font(ctx, PEN);
  const color = inkFor(rng, key);
  const lines = rng.chance(0.5) ? shuffled(rng, NOTES).slice(0, vertical ? 6 : 3) : shuffled(rng, TODOS).slice(0, vertical ? 8 : 5).map((t) => `– ${t}`);
  // sometimes a small print clipped over the top-right corner; the text column stops short of it
  const pr = m.fork();
  const snap: Attach[] = [];
  let right = w;
  if (!vertical && pr.chance(0.22)) {
    const meta = pickPhoto(pr);
    const pw = pr.range(92, 108), ph = pw / clamp(meta.w / meta.h, 0.75, 1.35);
    const p: Placed = { cx: w - 14 - pw / 2, cy: ph / 2 - pr.range(12, 22), w: pw, h: ph, angle: pr.range(-6, 4) };
    snap.push(...clipped(pr, p, printAttach(pr, meta, p, { border: pr.chance(0.6) ? pr.range(4, 6) : 0 }), 'clip'));
    right = bounds(p).x - 6;
  }
  layer.appendChild(fitInk(f, 17, color, { x: 18, y: 4, w: right - 32, h: 30 }, [{ text: rng.pick(TITLES), weight: '600' }], { pitch: 30, drop: false, maxLines: 1 }));
  // ruled: fixed 20px pitch, so shrink a little, then drop whole items rather than overflow the card
  const top = lined ? 41 : 44;
  layer.appendChild(fitInk(f, 17, color, { x: 22, y: top, w: right - 36, h: h - top - 8 }, lines.map((t) => ({ text: t })), { pitch: 20, min: 17 * f.size * 0.75 }));
  if (rng.chance(0.15)) coffeeRing(rng, layer, w, h);
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { radius: 1 },
    relief: { bend: rng.range(-3, 4), bendAngle: rng.range(0, 180), wrinkles: rng.chance(0.2) ? 0.12 : 0 },
    finish: { edgeWear: rng.range(0, 0.6) },
  };
  const attach = [...snap, ...attachments(ctx, w, h, { allowClip: !snap.length })];
  const spec = motion(mo, underlineTitle(m, '.ink:first-of-type > div', color));
  return { w, h, rot: rng.range(-7, 7), paper: key, look, ink: layer, attach, info: info(`${lined ? 'Index card (ruled)' : 'Index card'}${snap.length ? ' + photo' : ''}`, key, [f.family], attach), motion: spec };
};

const notebook: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const w = rng.int(240, 270), h = rng.int(320, 350);
  const key = rng.pick(['drawing-pad', 'printer', 'sketchbook-cream', 'sketchbook', 'pastel-light-cream']);
  const layer = div('layer');
  const grid = rng.chance(0.25);
  layer.appendChild(div(grid ? 'rules dots' : 'rules notebook'));
  const f = font(ctx, PEN);
  const color = inkFor(rng, key);
  const doodle = rng.chance(0.55);
  const top = grid ? 30 : 33;
  layer.appendChild(ink(f, 13, color, `right:16px;top:${top - 22}px;opacity:.8`, esc(rng.pick(DATES))));
  const blocks: FitBlock[] = [{ text: rng.pick(TITLES), cls: 't', keep: true }, ...shuffled(rng, NOTES).slice(0, rng.int(4, 7)).map((t) => ({ text: t }))];
  // no doodle: sometimes a print taped in at the bottom, and the notes stop above it
  const pr = m.fork();
  const snap: Attach[] = [];
  let textH = h - top - 14 - (doodle ? 84 : 0);
  if (!doodle && pr.chance(0.35)) {
    const meta = pickPhoto(pr);
    const pw = pr.range(116, 146), ph = pw / clamp(meta.w / meta.h, 0.8, 1.5);
    const p: Placed = { cx: w - 18 - pw / 2 + pr.range(-14, 4), cy: h - 20 - ph / 2, w: pw, h: ph, angle: pr.range(-8, 8) };
    snap.push(printAttach(pr, meta, p, { border: pr.chance(0.5) ? pr.range(5, 7) : 0 }), ...photoTapes(pr, p));
    textH = Math.floor((bounds(p).y - 6 - top) / 22) * 22;
  }
  layer.appendChild(fitInk(f, 16, color, { x: 46, y: top, w: w - 62, h: textH }, blocks, { pitch: 22, min: 16 * f.size * 0.75 }));
  if (doodle) {
    const sw = 96, sh = 76;
    const pencil = rng.chance(0.5);
    layer.appendChild(div('doodle', `right:12px;bottom:14px;width:${sw}px;height:${sh}px`, sketchSVG(rng, sw, sh, { ink: pencil ? INKS.graphite : color, width: pencil ? 1.1 : 1.3, pencil, name: rng.pick(['stars', 'smiley', 'cube', 'bulb']) })));
  }
  const spiral = rng.chance(0.7);
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: spiral
      ? { edges: { left: torn(3, 9) }, holeRows: [{ x: 13, y: 11, dx: 0, dy: 22, count: Math.floor(h / 22), r: 4.6, tear: rng.range(0.15, 0.5), rough: 0.5 }] }
      : { edges: { left: torn(rng.range(4, 7)) }, holeRows: [{ x: 18, y: h * 0.18, dx: 0, dy: h * 0.32, count: 3, r: 5.5, rough: 0.2 }] },
    relief: {
      wrinkles: rng.chance(0.4) ? rng.range(0.05, 0.18) : 0,
      curl: { amount: rng.range(0, 7), corners: [rng.pick(['tr', 'br'] as const)] },
      folds: rng.chance(0.2) ? { y: 2, strength: 0.7 } : undefined,
    },
  };
  const attach = [...snap, ...attachments(ctx, w, h)];
  const spec = motion(mo, [...highlightLine(m, '.t', isDark(key) ? '#74c0fc' : '#4dabf7'), ...(doodle ? drawDoodle('.doodle svg', 1.4) : [])], { stagger: -0.2 });
  return { w, h, rot: rng.range(-6, 6), paper: key, look, ink: layer, attach, info: info(`${spiral ? 'Notebook page (spiral)' : 'Notebook page (3-hole)'}${snap.length ? ' + photo' : ''}`, key, [f.family], attach), motion: spec };
};

const napkin: Maker = (ctx) => {
  const { rng } = ctx;
  const s = rng.int(236, 270);
  const layer = div('layer');
  layer.appendChild(div('emboss'));
  const color = inkFor(rng, 'napkin', ['ballpoint', 'ballpoint', 'black', 'red']);
  const sw = s - 40, sh = s * 0.62;
  layer.appendChild(div('doodle', `left:20px;top:22px;width:${sw}px;height:${sh}px`, sketchSVG(rng, sw, sh, { ink: color, width: 1.6, name: rng.pick(['wireframe', 'phone', 'flow', 'chart', 'bulb', 'landscape', 'cube']) })));
  const f = font(ctx, PEN);
  const ny = 22 + sh + 4;
  layer.appendChild(fitInk(f, 17, color, { x: 22, y: ny, w: s - 42, h: s - ny - 12 }, [{ text: rng.pick(NOTES) }], { lineHeight: 1.1 }, `transform:rotate(${rng.range(-3, 2)}deg)`));
  if (rng.chance(0.45)) coffeeRing(rng, layer, s, s);
  const deckle = { kind: 'deckle' as const, amount: 1.4, scale: 8 };
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { edges: { top: deckle, right: deckle, bottom: deckle, left: deckle }, rim: 1.2 },
    relief: { folds: { x: 2, y: 2, strength: rng.range(0.8, 1.4), wear: 0.15 }, crumples: rng.range(0.07, 0.2), crumpleSize: rng.range(80, 130), wrinkles: rng.range(0.04, 0.12) },
  };
  return { w: s, h: s, rot: rng.range(-12, 12), paper: 'napkin', look, ink: layer, attach: [], info: info('Napkin sketch', 'napkin', [f.family], []) };
};

const tag: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(132, 150), h = rng.int(240, 270);
  const key = rng.pick(['kraft', 'kraft-light', 'kraft-light', 'handmade-ivory', 'oatmeal', 'pastel-light-yellow', 'kraft-gray']);
  const layer = div('layer');
  const mono = font(ctx, MONO, false);
  const stampInk = rng.pick(['#b52a2a', '#1f3b7a', '#222']);
  layer.appendChild(ink(mono, 13, stampInk, `left:0;right:0;top:58px;text-align:center;letter-spacing:.12em;filter:url(#f-stamp)`, `No. ${String(rng.int(1, 9999)).padStart(4, '0')}`));
  const hand = font(ctx, PEN);
  const color = inkFor(rng, key, ['black', 'ballpoint', 'sepia']);
  const label = rng.chance(0.5) ? `for ${rng.pick(NAMES).split(' ')[0]}` : rng.pick(LABELS);
  layer.appendChild(fitInk(hand, 22, color, { x: 12, y: 92, w: w - 24, h: 64 }, [{ text: label }], { lineHeight: 1.1 }, 'text-align:center'));
  layer.appendChild(fitInk(hand, 15, color, { x: 12, y: h - 44, w: w - 24, h: 24 }, [{ text: rng.pick(DATES) }], { lineHeight: 1.2, drop: false, maxLines: 1 }, 'text-align:center'));
  // Shipping tags: a glued reinforcing patch (~2.4x the hole) or a metal eyelet, and a cord
  // tied through the hole with a lark's head (see cords.ts).
  const hx = w / 2, hy = 28, hr = 6;
  const attach: Attach[] = [];
  const eyelet = rng.chance(0.3);
  if (eyelet) {
    attach.push({ type: 'prop', x: hx, y: hy, layer: 'front', prop: { kind: 'eyelet', color: rng.pick(['#c9a64f', '#c9ccd0', '#b07a4a']) }, label: 'metal eyelet' });
  } else {
    const patch = rng.pick([
      { paper: key === 'kraft' ? 'kraft-light' : 'kraft' },
      { paper: 'construction-red', params: { color: { base: '#9c4a33', tint: '#8f412c' } } },
      { paper: 'printer', params: { color: { base: '#efe9da', tint: '#efe9da' } } },
      { paper: 'kraft-gray' },
    ]);
    const pr = hr * 2.4;
    attach.push({
      type: 'sheet',
      x: hx,
      y: hy,
      w: pr * 2,
      h: pr * 2,
      angle: 0,
      layer: 'front',
      paper: patch.paper,
      params: patch.params,
      look: { seed: rng.int(1, 1e6), shape: { radius: pr, holes: [{ x: pr, y: pr, r: hr + 0.4 }] }, shadow: { softness: 0.6, offsetX: 0.2, offsetY: 0.4, strength: 0.35, lift: 0 } },
      label: 'reinforcing patch',
    });
  }
  const cord = tagCord(rng, hx, hy, hr, w);
  attach.push({ type: 'cord', spec: cord.spec, label: cord.label });
  const look: SheetLook = { seed: rng.int(1, 1e6), shape: { chamfer: 24, holes: [{ x: hx, y: hy, r: hr }] }, relief: { bend: rng.range(-4, 5), bendAngle: 90 }, finish: { edgeWear: rng.range(0.2, 0.8) } };
  return { w, h, rot: rng.range(-14, 14), paper: key, look, ink: layer, attach, info: info('Shipping tag', key, [mono.family, hand.family], attach) };
};

const receipt: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const w = rng.int(180, 205);
  const items = shuffled(rng, ITEMS).slice(0, rng.int(2, 5)) as [string, number][];
  const h = 230 + items.length * 18;
  const layer = div('layer');
  const f = font(ctx, RECEIPT, false);
  const [shop, addr] = rng.pick(SHOPS);
  const total = items.reduce((t, [, p]) => t + p, 0);
  const html =
    `<div class="c b">${esc(shop)}</div><div class="c">${esc(addr)}</div><div class="c">${rng.int(1, 12)}/${rng.int(1, 28)}/26 ${rng.int(7, 21)}:${String(rng.int(0, 59)).padStart(2, '0')}</div><div class="hr"></div>` +
    items.map(([n, p]) => `<div class="li"><span>${esc(n)}</span><span>${fmtMoney(p)}</span></div>`).join('') +
    `<div class="hr"></div><div class="li b"><span>TOTAL</span><span>${fmtMoney(total)}</span></div><div class="li"><span>CARD ****${rng.int(1000, 9999)}</span></div><div class="c" style="margin-top:8px">THANK YOU!</div>` +
    barcode(rng, w - 60, 26);
  const faded = rng.range(0.55, 0.9);
  const g = `linear-gradient(${rng.int(0, 180)}deg,#000 40%,rgba(0,0,0,.55))`;
  layer.appendChild(ink(f, 11.5, '#2b2b2e', `left:14px;right:14px;top:16px;line-height:1.35;opacity:${faded.toFixed(2)};-webkit-mask:${g};mask:${g}`, html, 'receipt'));
  const fonts = [f.family];
  if (rng.chance(0.3)) {
    const hand = font(ctx, PEN);
    fonts.push(hand.family);
    layer.appendChild(ink(hand, 18, INKS.ballpoint, `right:14px;bottom:44px;transform:rotate(-8deg)`, 'expense!', 'exp'));
  }
  const crumpled = rng.chance(0.45);
  const zz = { kind: 'zigzag' as const, amount: 3, scale: 6 };
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { edges: { top: zz, bottom: zz } },
    relief: { bend: rng.range(3, 9), bendAngle: 0, crumples: crumpled ? rng.range(0.07, 0.16) : 0, crumpleSize: 90, wrinkles: crumpled ? rng.range(0.05, 0.12) : 0.03 },
    finish: { gloss: 0.06 },
  };
  const attach = attachments(ctx, w, h);
  const spec = motion(mo, [...circleWord(m, '.li.b', m.pick([INKS.red, INKS.ballpoint])), ...riseIn('.exp', 6, '>-0.2')], { delay: 0.2 });
  return { w, h, rot: rng.range(-10, 10), paper: 'thermal', look, ink: layer, attach, info: info(crumpled ? 'Receipt (crumpled)' : 'Receipt', 'thermal', fonts, attach), motion: spec };
};

const memo: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const w = rng.int(270, 300), h = rng.int(340, 380);
  const key = rng.pick(['sketchbook-cream', 'parchment', 'handmade-ivory', 'printer', 'oatmeal', 'newsprint-old', 'pastel-light-cream']);
  const layer = div('layer');
  const handWritten = ctx.mood === 'hand';
  const f = handWritten ? penned(ctx, rng.pick(PEN)) : ctx.mood === 'mono' ? rng.pick(MONO) : rng.pick(TYPEWRITER);
  const name = rng.pick(NAMES).split(' ')[0];
  const [q] = rng.pick(QUOTES);
  const body = `Dear ${name},\n\n${q} ${cap(rng.pick(NOTES))}. Also: ${trim(rng.pick(NOTES))}, and ${trim(rng.pick(NOTES))}.\n\nMore soon —`;
  const color = isDark(key) ? '#eee' : rng.pick(['#232227', '#232227', '#3a2a22', '#8a1f22']);
  const date = rng.pick(DATES);
  layer.appendChild(
    fitInk(
      f,
      13.5,
      color,
      { x: 26, y: 26, w: w - 50, h: h - 26 - 84 },
      [{ text: date, cls: 'r', keep: true }, { text: body, html: handWritten ? undefined : typed(rng, body), gap: 0.4 }],
      { lineHeight: 1.55, whiteSpace: 'pre-wrap', drop: false },
      'white-space:pre-wrap',
      'typed',
    ),
  );
  const sig = penned(ctx, rng.pick(HAND.filter((x) => ['Homemade Apple', 'Reenie Beanie', 'Caveat', 'Nanum Pen Script', 'Shadows Into Light'].includes(x.family))));
  layer.appendChild(ink(sig, 26, INKS.ballpoint, `left:40px;bottom:${rng.int(26, 46)}px;transform:rotate(${rng.range(-6, 2)}deg)`, esc(rng.pick(NAMES).split(' ')[0]), 'sig'));
  if (rng.chance(0.2)) coffeeRing(rng, layer, w, h);
  const old = key === 'parchment' || key === 'newsprint-old' || rng.chance(0.25);
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: rng.chance(0.3) ? { edges: { top: 'cut', right: 'cut', bottom: 'cut', left: 'cut' } } : undefined,
    relief: { folds: rng.chance(0.7) ? { y: 3, strength: rng.range(0.7, 1.3), wear: 0.35 } : undefined, wrinkles: rng.range(0, 0.08) },
    finish: { aging: old ? rng.range(0.3, 0.7) : 0, edgeWear: old ? rng.range(0.3, 0.8) : 0 },
  };
  const attach = attachments(ctx, w, h);
  // typed letters type on glyph by glyph; handwritten ones are revealed top to bottom; the signature lands last
  const spec = motion(mo, [...(handWritten ? writeOn('.ink.typed', 1.6) : typeIn('.ink.typed', 32)), ...riseIn('.sig', 5, '>+0.1')]);
  return { w, h, rot: rng.range(-5, 5), paper: key, look, ink: layer, attach, info: info('Typed letter', key, [f.family, sig.family], attach), motion: spec };
};

const watercolor: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(290, 320), h = rng.int(200, 220);
  const key = rng.pick(['watercolor-cold-press', 'watercolor-hot-press', 'watercolor-rough']);
  const layer = div('layer');
  const paints = shuffled(rng, PAINTS).slice(0, 6);
  const cols = 3, cw = (w - 30) / cols, ch = (h - 30) / 2;
  let svg = `<svg width="${w}" height="${h}" class="paint" style="filter:url(#f-wash)">`;
  const f = font(ctx, PEN);
  let labels = '';
  paints.forEach(([name, c], i) => {
    const cx = 15 + cw * (i % cols) + cw / 2, cy = 15 + ch * Math.floor(i / cols) + ch * 0.42;
    const r = Math.min(cw, ch) * rng.range(0.28, 0.34);
    svg += `<path d="${blobPath(rng, cx, cy, r, 0.22)}" fill="${c}" fill-opacity="${rng.range(0.45, 0.7).toFixed(2)}" stroke="${c}" stroke-opacity=".55" stroke-width="1.6"/>`;
    svg += `<path d="${blobPath(rng, cx - r * 0.2, cy - r * 0.15, r * 0.45, 0.4)}" fill="#fff" fill-opacity="${rng.range(0.08, 0.2).toFixed(2)}"/>`;
    labels += `<div style="position:absolute;left:${cx - cw / 2}px;width:${cw}px;top:${cy + r * 0.95}px;text-align:center;white-space:nowrap;letter-spacing:-.02em">${esc(name)}</div>`;
  });
  layer.insertAdjacentHTML('beforeend', svg + '</svg>');
  layer.appendChild(ink(f, 13, INKS.graphite, 'inset:0;filter:url(#f-pencil)', labels));
  const deckle = rng.chance(0.6);
  const d = { kind: 'deckle' as const, amount: 3, scale: 12 };
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: deckle ? { edges: { top: d, right: d, bottom: d, left: d }, rim: 2.5 } : undefined,
    relief: { cockle: rng.range(0.4, 1), cockleSize: rng.range(70, 110) },
  };
  const attach = attachments(ctx, w, h);
  return { w, h, rot: rng.range(-8, 8), paper: key, look, ink: layer, attach, info: info(deckle ? 'Watercolor swatches (deckle)' : 'Watercolor swatches', key, [f.family], attach) };
};

const bizcard: Maker = (ctx) => {
  const { rng } = ctx;
  const w = 252, h = 144;
  const key = rng.pick(['handmade-ivory', 'oatmeal', 'construction-black', 'pastel-dark-blue', 'kraft', 'pastel-mid-rose', 'handmade-navy', 'construction-white', 'pastel-black-patterned', 'handmade-green', 'chipboard']);
  const layer = div('layer');
  const f = font(ctx, MONO);
  const dark = isDark(key);
  const color = dark ? rng.pick(['#f1ece2', '#d9b866', '#e8e4dc']) : rng.pick(['#1f1e24', '#7a2420', '#1d2f5c', '#2a3a2c']);
  const [first, last] = rng.pick(NAMES).split(' ');
  const personal = rng.int(0, 1) === 0;
  if (personal) layer.appendChild(ink(f, 11, color, `right:20px;top:20px`, `<div class="mono-mark">${first[0]}${last[0]}</div>`, 'biz-mark'));
  // uppercase in the text itself (not CSS) so it is measured as rendered
  const blocks: FitBlock[] = personal
    ? [
        { text: `${first} ${last}`.toUpperCase(), cls: 'nm', scale: 1.35, spacing: 0.1, weight: '700', keep: true },
        { text: rng.pick(ROLES).toUpperCase(), cls: 'rl', spacing: 0.06, gap: 0.3, keep: true },
        { text: `${first.toLowerCase()}@${last.toLowerCase()}.studio`, cls: 'ct', scale: 0.92, spacing: 0.04, gap: 0.9, keep: true },
      ]
    : [
        { text: rng.pick(STUDIOS), cls: 'nm', scale: 1.7, spacing: 0.1, weight: '700', keep: true },
        { text: `${first} ${last} · ${rng.pick(ROLES)}`.toUpperCase(), cls: 'rl', spacing: 0.06, gap: 1.6, keep: true },
        { text: `+1 555 ${rng.int(100, 999)} ${rng.int(1000, 9999)}`, cls: 'ct', scale: 0.92, spacing: 0.04, gap: 0.9, keep: true },
      ];
  layer.appendChild(fitInk(f, 11, color, { x: 20, y: personal ? 60 : 20, w: w - 40, h: personal ? h - 76 : h - 36 }, blocks, { lineHeight: 1.25, weight: '400' }, '', `biz ${dark ? '' : 'press'}`));
  const look: SheetLook = { seed: rng.int(1, 1e6), shape: { radius: rng.chance(0.3) ? 6 : 0.6 }, shadow: { softness: 3.5, strength: 1.15 }, finish: { edgeWear: rng.range(0, 0.4) } };
  const attach = attachments({ ...ctx, attachRate: ctx.attachRate * 0.6 }, w, h);
  return { w, h, rot: rng.range(-9, 9), paper: key, look, ink: layer, attach, info: info('Business card', key, [f.family], attach) };
};

const graph: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(220, 260), h = rng.int(190, 230);
  const key = rng.pick(['printer', 'construction-white', 'pastel-light-cream', 'newsprint']);
  const layer = div('layer');
  const g = div('rules graph');
  g.style.setProperty('--g', rng.pick(['60,140,120', '70,110,190', '190,90,80']));
  layer.appendChild(g);
  const pencil = rng.chance(0.6);
  const color = pencil ? INKS.graphite : inkFor(rng, key);
  const sw = w - 50, sh = h - 70;
  layer.appendChild(div('doodle', `left:20px;top:20px;width:${sw}px;height:${sh}px`, sketchSVG(rng, sw, sh, { ink: color, width: pencil ? 1.2 : 1.4, pencil, name: rng.pick(['chart', 'cube', 'flow', 'wireframe']) })));
  const f = font(ctx, [...PEN, ...MONO.slice(0, 3)]);
  layer.appendChild(fitInk(f, 14, color, { x: 22, y: h - 40, w: w - 40, h: 24 }, [{ text: `fig. ${rng.int(1, 9)} — ${rng.pick(['rough', 'v2', 'idea', 'sketch', 'growth?', 'layout'])}` }], { lineHeight: 1.2, drop: false, maxLines: 1 }, pencil ? 'filter:url(#f-pencil)' : ''));
  const edges: Partial<Record<'top' | 'right' | 'bottom' | 'left', ReturnType<typeof torn>>> = {};
  for (const s of ['top', 'right', 'bottom', 'left'] as const) if (rng.chance(0.55)) edges[s] = torn(rng.range(4, 8));
  if (!Object.keys(edges).length) edges.top = torn(6);
  const look: SheetLook = { seed: rng.int(1, 1e6), shape: { edges }, relief: { wrinkles: rng.range(0, 0.15) } };
  const attach = attachments(ctx, w, h);
  return { w, h, rot: rng.range(-12, 12), paper: key, look, ink: layer, attach, info: info('Graph paper scrap', key, [f.family], attach) };
};

const SCRAP_PAPERS = [
  'handmade-green', 'handmade-yellow', 'handmade-navy', 'handmade-sky', 'handmade-rust', 'oatmeal',
  'construction-red', 'construction-orange', 'construction-yellow', 'construction-green', 'construction-blue', 'construction-sky', 'construction-purple',
  'pastel-mid-rose', 'pastel-mid-green', 'pastel-mid-cool', 'pastel-dark-blue', 'pastel-dark-rose', 'pastel-black',
  'kraft', 'kraft-rough', 'chipboard', 'cardboard-corrugated', 'cardboard', 'watercolor-rough',
];

const scrap: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(110, 230), h = rng.int(90, 200);
  const key = rng.pick(SCRAP_PAPERS);
  const fonts: string[] = [];
  let layer: HTMLElement | null = null;
  if (rng.chance(0.45)) {
    layer = div('layer');
    const f = penned(ctx, rng.pick(HAND.filter((x) => x.marker || x.family === 'Caveat' || x.family === 'Covered By Your Grace')));
    fonts.push(f.family);
    // torn edges bite up to ~13px: keep the word well inside
    const bh = Math.min(h - 40, 56);
    layer.appendChild(fitInk(f, 22, inkFor(rng, key, ['black', 'black', 'red']), { x: 20, y: (h - bh) / 2, w: w - 40, h: bh }, [{ text: rng.pick([...LABELS, 'hello', 'yes!', 'wow', 'later', 'colour?']) }], { lineHeight: 1.1, drop: false }, `transform:rotate(${rng.range(-8, 8)}deg);text-align:center;display:flex;flex-direction:column;justify-content:center`));
  }
  const thick = key.startsWith('card') || key === 'chipboard';
  const t = () => (rng.chance(0.85) ? torn(rng.range(6, 13), rng.range(18, 40)) : undefined);
  const crumpled = !thick && rng.chance(0.4);
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { edges: { top: t(), right: t(), bottom: t(), left: t() }, rim: thick ? 1.5 : 2.6 },
    relief: { crumples: crumpled ? rng.range(0.1, 0.22) : 0, crumpleSize: rng.range(60, 100), wrinkles: crumpled ? rng.range(0.04, 0.12) : 0 },
    shadow: thick ? { softness: 4, strength: 1.2 } : undefined,
  };
  const attach = attachments({ ...ctx, attachRate: ctx.attachRate * 0.5 }, w, h, { allowClip: false });
  return { w, h, rot: rng.range(-30, 30), paper: key, look, ink: layer, attach, info: info(crumpled ? 'Paper scrap (crumpled)' : 'Paper scrap', key, fonts, attach) };
};

const ticket: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(250, 280), h = rng.int(100, 116);
  const key = rng.pick(['construction-red', 'construction-orange', 'construction-yellow', 'construction-sky', 'construction-green', 'kraft-light', 'pastel-mid-rose', 'construction-purple', 'pastel-light-yellow']);
  const stub = Math.round(w * 0.72);
  const layer = div('layer');
  const f = font(ctx, MONO, false);
  const color = isDark(key) ? '#f1ece2' : '#22202a';
  const [top, ev] = rng.pick(EVENTS);
  const no = String(rng.int(1, 999999)).padStart(6, '0');
  layer.appendChild(
    fitInk(
      f,
      18,
      color,
      { x: 18, y: 14, w: stub - 30, h: h - 24 },
      [
        { text: top, spacing: 0.04, keep: true },
        { text: `${ev} · ${rng.pick(DATES)}`, scale: 0.6, gap: 0.5, spacing: 0.04, cls: 'dim', keep: true },
        { text: `Nº ${no}`, scale: 0.62, gap: 0.9, spacing: 0.04, cls: 'num', keep: true },
      ],
      { lineHeight: 1.1 },
    ),
  );
  layer.appendChild(fitInk(f, 10, color, { x: stub + 6, y: 6, w: h - 12, h: w - stub - 12 }, [{ text: `${top} · ${no}`, spacing: 0.12 }], { lineHeight: 1.2, vertical: true, drop: false, maxLines: 1, min: 6 }, 'writing-mode:vertical-rl;text-align:center'));
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { holes: [{ x: 0, y: h / 2, r: 9 }, { x: w, y: h / 2, r: 9 }], holeRows: [{ x: stub, y: 5, dx: 0, dy: 6.5, count: Math.floor((h - 10) / 6.5) + 1, r: 1.3 }] },
    relief: { bend: rng.range(-3, 3) },
    shadow: { softness: 4, strength: 1.1 },
  };
  const attach = attachments({ ...ctx, attachRate: ctx.attachRate * 0.5 }, w, h);
  return { w, h, rot: rng.range(-16, 16), paper: key, look, ink: layer, attach, info: info('Ticket stub', key, [f.family], attach) };
};

const clipping: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(220, 250), h = rng.int(270, 320);
  const key = rng.pick(['newsprint', 'newsprint-old', 'newsprint-old']);
  const layer = div('layer');
  const f = font(ctx, MONO.filter((x) => x.family !== 'Major Mono Display' && x.family !== 'VT323'), false);
  layer.appendChild(ink(f, 8.5, '#1d1c1f', `inset:14px 14px 10px;overflow:hidden`, `<div class="hl">${esc(rng.pick(HEADLINES))}</div><div class="by">BY ${esc(rng.pick(NAMES).toUpperCase())} · STAFF</div><div class="cols">${esc(BODY)} ${esc(BODY)}</div>`, 'news'));
  const fonts = [f.family];
  if (rng.chance(0.4)) {
    const hand = font(ctx, PEN);
    fonts.push(hand.family);
    layer.appendChild(ink(hand, 20, INKS.red, `right:16px;top:${rng.int(70, 140)}px;transform:rotate(-10deg)`, 'keep!'));
  }
  const cut = { kind: 'cut' as const, amount: 2, scale: rng.range(30, 60) };
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { edges: { top: cut, right: cut, bottom: cut, left: cut } },
    relief: { folds: rng.chance(0.4) ? { x: 2, strength: 0.6 } : undefined, wrinkles: rng.range(0, 0.1), curl: { amount: rng.range(0, 6), sides: [rng.pick(['left', 'right'] as const)] } },
    finish: { aging: key === 'newsprint-old' ? rng.range(0.2, 0.6) : 0.1, edgeWear: 0.4 },
  };
  const attach = attachments(ctx, w, h);
  return { w, h, rot: rng.range(-8, 8), paper: key, look, ink: layer, attach, info: info('Newspaper clipping', key, fonts, attach) };
};

const quote: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const w = rng.int(230, 270), h = rng.int(150, 180);
  const key = rng.pick(['pastel-dark-blue', 'construction-black', 'pastel-black', 'kraft', 'handmade-navy', 'handmade-rust', 'pastel-mid-green', 'handmade-ivory', 'parchment']);
  const layer = div('layer');
  const f = font(ctx, [...PEN, ...HAND.filter((x) => x.marker)]);
  const color = inkFor(rng, key, ['black', 'sepia', 'ballpoint']);
  const [q, who] = rng.pick(QUOTES);
  const blocks: FitBlock[] = [{ text: `“${q}”`, html: mark(`“${q}”`, 'q'), keep: true }];
  if (who) blocks.push({ text: `— ${who}`, scale: 0.7, gap: 0.5, cls: 'dim', keep: true });
  layer.appendChild(fitInk(f, 22, color, { x: 20, y: 18, w: w - 40, h: h - 36 }, blocks, { lineHeight: 1.2 }, 'display:flex;flex-direction:column;justify-content:center'));
  const look: SheetLook = { seed: rng.int(1, 1e6), relief: { bend: rng.range(-3, 3) }, shadow: { softness: 4.5 } };
  const attach = attachments(ctx, w, h);
  const spec = motion(mo, [...bracketQuote(m, '.q', color), ...(who ? fadeIn('.dim', 0.4, '>-0.2') : [])]);
  return { w, h, rot: rng.range(-8, 8), paper: key, look, ink: layer, attach, info: info('Quote card', key, [f.family], attach), motion: spec };
};

const stamp: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const w = rng.pick([72, 80]), h = rng.pick([88, 96]);
  const step = 8;
  const layer = div('layer');
  const c1 = rng.pick(['#c7473b', '#2f6aa8', '#3e8a5b', '#d39a2c', '#7a4fa3', '#2e3d5c']);
  const c2 = mix(c1, '#ffffff', 0.55);
  const scene = rng.int(0, 2);
  const art =
    scene === 0
      ? `<circle cx="46" cy="24" r="9" fill="${c2}"/><path d="M0 70 L18 40 L32 58 L46 30 L64 70 Z" fill="${c1}"/>`
      : scene === 1
        ? `<circle cx="32" cy="34" r="16" fill="none" stroke="${c1}" stroke-width="4"/><circle cx="32" cy="34" r="5" fill="${c1}"/>`
        : `<path d="M10 66 Q30 20 54 66" fill="none" stroke="${c1}" stroke-width="5"/><rect x="8" y="14" width="10" height="10" fill="${c2}"/>`;
  const f = rng.pick(MONO.filter((x) => ['Space Mono', 'IBM Plex Mono', 'JetBrains Mono'].includes(x.family)));
  layer.appendChild(
    div(
      'print',
      `inset:9px;background:${mix(c1, '#ffffff', 0.82)};border:1px solid ${mix(c1, '#ffffff', 0.4)}`,
      `<svg viewBox="0 0 64 74" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${art}</svg>`,
    ),
  );
  layer.appendChild(ink(f, 11, mix(c1, '#000000', 0.35), `right:13px;bottom:12px;font-weight:700`, `${rng.int(1, 9)}0¢`));
  if (rng.chance(0.6)) {
    layer.appendChild(
      div(
        'postmark',
        `left:${rng.range(-30, 10)}px;top:${rng.range(10, 40)}px;transform:rotate(${rng.range(-20, 20)}deg)`,
        `<svg width="90" height="50"><circle cx="25" cy="25" r="20" fill="none" stroke="#222" stroke-width="1.5"/>${[0, 1, 2, 3].map((i) => `<path d="M48 ${12 + i * 8} q 10 -5 20 0 t 20 0" fill="none" stroke="#222" stroke-width="1.5"/>`).join('')}</svg>`,
      ),
    );
  }
  const holeRows = [
    { x: 0, y: 0, dx: step, dy: 0, count: w / step + 1, r: 2.6 },
    { x: 0, y: h, dx: step, dy: 0, count: w / step + 1, r: 2.6 },
    { x: 0, y: 0, dx: 0, dy: step, count: h / step + 1, r: 2.6 },
    { x: w, y: 0, dx: 0, dy: step, count: h / step + 1, r: 2.6 },
  ];
  const look: SheetLook = { seed: rng.int(1, 1e6), shape: { holeRows }, relief: { bend: rng.range(-2, 2) }, shadow: { softness: 2.5, offsetX: 1, offsetY: 2.5 } };
  const spec = motion(mo, [...fadeIn('.print', 0.3), ...stampIn('.postmark')], { stagger: 0.15 });
  return { w, h, rot: rng.range(-20, 20), paper: 'printer', look, ink: layer, attach: [], info: info('Postage stamp', 'printer', [f.family], []), motion: spec };
};

const tracing: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(220, 280), h = rng.int(180, 240);
  const layer = div('layer');
  const sw = w - 40, sh = h - 50;
  layer.appendChild(div('doodle', `left:20px;top:16px;width:${sw}px;height:${sh}px`, sketchSVG(rng, sw, sh, { ink: INKS.graphite, width: 1.2, pencil: true, name: rng.pick(['wireframe', 'landscape', 'cube', 'phone', 'flow']) })));
  const f = font(ctx, PEN);
  layer.appendChild(ink(f, 14, INKS.graphite, `left:20px;bottom:12px;filter:url(#f-pencil)`, esc(`trace ${rng.int(1, 4)} — ${rng.pick(['overlay', 'grid', 'v3', 'alt'])}`)));
  const look: SheetLook = { seed: rng.int(1, 1e6), relief: { wrinkles: rng.range(0.05, 0.25), wrinkleSize: 30, bend: rng.range(-4, 4) }, finish: { opacity: rng.range(0.58, 0.72), gloss: 0.12 }, shadow: { strength: 0.6 } };
  const attach = attachments({ ...ctx, attachRate: Math.max(0.6, ctx.attachRate) }, w, h, { allowClip: false });
  return { w, h, rot: rng.range(-10, 10), paper: 'tracing', look, ink: layer, attach, info: info('Tracing paper', 'tracing', [f.family], attach) };
};

const tapeLabel: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(120, 190), h = rng.int(26, 32);
  const layer = div('layer');
  const f = penned(ctx, rng.pick(HAND.filter((x) => x.marker || ['Caveat', 'Covered By Your Grace', 'Gochi Hand', 'Kalam'].includes(x.family))));
  // one line only: the box is shorter than two lines at any size we allow
  layer.appendChild(fitInk(f, 17, rng.pick(['#1f1e24', '#1f1e24', '#b1272d', '#22337f']), { x: 8, y: 0, w: w - 16, h }, [{ text: rng.pick([...LABELS, 'drawer 3', 'SCRAPS', 'do not toss', 'inks', 'samples', 'misc.']) }], { lineHeight: 1.05, drop: false, min: 7, maxLines: 1 }, 'display:flex;flex-direction:column;justify-content:center;text-align:center'));
  const ends = torn(2.4, 3.5);
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { edges: { left: ends, right: ends }, rim: 0.8 },
    finish: { opacity: 0.92 },
    relief: { wrinkles: rng.range(0, 0.25), wrinkleSize: 10 },
    shadow: { strength: 0.55, softness: 1.4, offsetX: 0.5, offsetY: 1.2, lift: 0 },
  };
  return { w, h, rot: rng.range(-12, 12), paper: 'masking', look, ink: layer, attach: [], info: info('Masking-tape label', 'masking', [f.family], []) };
};

// ---------------------------------------------------------------- photos

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const boxCss = (b: Box) => `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
/** Faces that read like a Sharpie or felt pen on a print. */
const CAPTION_FONTS = HAND.filter((x) => x.marker || ['Caveat', 'Covered By Your Grace', 'Gochi Hand', 'Kalam', 'Reenie Beanie', 'Just Another Hand', 'Shadows Into Light'].includes(x.family));
const captionFor = (rng: Rng, meta: PhotoMeta) => (rng.chance(0.75) ? rng.pick(meta.captions) : rng.pick(PHOTO_CAPTIONS));

/** A print attached to a card at `p`: white border (or borderless), its own sheet, graded photo. */
function printAttach(rng: Rng, meta: PhotoMeta, p: Placed, o: { border?: number; bottom?: number; grade?: Grade; radius?: number; paper?: string; label?: string } = {}): Attach {
  const b = o.border ?? 0, bottom = o.bottom ?? b;
  const paper = o.paper ?? (b && rng.chance(0.4) ? 'photo-matte' : 'photo-gloss');
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { radius: o.radius ?? (b ? 0.8 : rng.range(1.5, 4)) },
    relief: { bend: rng.range(-2.5, 2.5), bendAngle: rng.range(0, 180), curl: rng.chance(0.3) ? { amount: rng.range(1.5, 4), radius: 40, corners: [rng.pick(['tl', 'tr', 'br', 'bl'] as const)] } : undefined },
    finish: { gloss: paper === 'photo-gloss' ? 0.4 : 0.08, edgeWear: rng.range(0, 0.25) },
    shadow: { strength: 0.85, softness: 2.2, offsetX: 0.8, offsetY: 2, lift: 0.3 },
  };
  const grade = o.grade ?? rng.pick(['none', 'none', 'warm', 'faded', 'instant', 'bw'] as const);
  const photo: PhotoSpec = { id: meta.id, grade, vignette: rng.range(0.1, 0.3), grain: rng.range(0.2, 0.5), leak: rng.chance(0.08), seed: rng.int(1, 1e6) };
  const window = { x: b, y: b, w: p.w - 2 * b, h: p.h - b - bottom };
  return { type: 'photo', cx: p.cx, cy: p.cy, w: p.w, h: p.h, angle: p.angle, layer: 'front', paper, look, photo, window, label: o.label ?? (b ? 'photo print' : 'borderless print') };
}

/** Two strips of tape over opposite corners of a print: they hold the print to the card, not the card to the desk. */
function photoTapes(rng: Rng, p: Placed, style: TapeStyle = rng.pick(['masking', 'masking', 'washi', 'clear'] as const)): Attach[] {
  const diag = rng.chance(0.5) ? [[-1, -1], [1, 1]] : [[1, -1], [-1, 1]];
  return diag.map(([sx, sy]) => {
    const [x, y] = cornerOf(p, sx, sy);
    return { ...tapeSheet(rng, x, y, rng.range(42, 56), p.angle + (sx * sy > 0 ? 45 : -45) + rng.range(-8, 8), style), binds: true };
  });
}

/**
 * A print held to its card by a paper clip or binder clip. A clip can only grip
 * the edge of the whole stack, so the clip sits on the print's own edge (top,
 * or a side: `side` = -1 left / 1 right), turned with the print, and the print
 * is moved so that edge lies just past the card's edge: both sheets end up in
 * the jaw. Mutates `p` (and the print) to the moved position; returns the
 * attachments in paint order: clip back (under the card), print, clip front.
 */
function clipped(rng: Rng, p: Placed, print: Attach, kind: 'clip' | 'binder', side = 0, W = 0): Attach[] {
  // a clipped print is pressed flat against the card: only a slight tilt
  p.angle = clamp(p.angle, -3, 3);
  const a = (p.angle * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const toCard = (lx: number, ly: number): [number, number] => [p.cx + lx * c - ly * sn, p.cy + lx * sn + ly * c];
  const t = rng.range(-1, 1) * (kind === 'binder' ? 0.12 : 0.28);
  // the gripped point on the print's edge, in the print's frame, and the direction into the print
  const [ex, ey] = side ? [(side * p.w) / 2, t * p.h] : [t * p.w, -p.h / 2];
  const [ix, iy] = side ? [-side, 0] : [0, 1];
  const over = rng.range(0, 3);
  const [Ex, Ey] = toCard(ex, ey);
  if (side) p.cx += (side < 0 ? -over : W + over) - Ex;
  else p.cy += -over - Ey;
  if (print.type === 'photo') (print.cx = p.cx), (print.cy = p.cy), (print.angle = p.angle);
  // the prop's origin sits this far in from the gripped edge (see props.ts)
  const inset = kind === 'binder' ? 8 : 4;
  const [x, y] = toCard(ex + ix * inset, ey + iy * inset);
  const angle = p.angle + side * 90;
  if (kind === 'binder') {
    const prop: PropSpec = { kind: 'binder', color: rng.pick(['#1d1d22', '#1d1d22', '#c23b3b', '#2d5bb8']), angle };
    return [print, { type: 'prop', x, y, layer: 'front', prop, label: 'binder clip' }];
  }
  const color = rng.pick(['#cfd3d8', '#cfd3d8', '#d24a4a', '#3a6fd2', '#e9c03a']);
  return [
    { type: 'prop', x, y, layer: 'back', prop: { kind: 'paperclip', color, angle, part: 'back' }, label: 'paper clip' },
    print,
    { type: 'prop', x, y, layer: 'front', prop: { kind: 'paperclip', color, angle, part: 'front' }, label: '' },
  ];
}

/** Album photo corners: four paper pockets at the corners of a print. */
function photoCorners(p: Placed, color: string): Attach[] {
  const out: Attach[] = [];
  for (const [sx, sy, r] of [[-1, -1, 0], [1, -1, 90], [1, 1, 180], [-1, 1, 270]]) {
    const [x, y] = cornerOf(p, sx, sy);
    // drawn for the top-left corner: the print runs off to +x / +y; the svg sits at (-4, -4)
    const svg = `<svg width="30" height="30"><path d="M1.5 1.5 L24 1.5 L1.5 24 Z" fill="${color}"/><path d="M5.6 5.6 L19.5 5.6 M5.6 5.6 L5.6 19.5" stroke="rgba(255,255,255,0.18)" stroke-width="0.8" fill="none"/></svg>`;
    const el = div('photo-corner', `left:${x}px;top:${y}px;transform-origin:0 0;transform:rotate(${p.angle + r}deg)`, svg);
    out.push({ type: 'html', layer: 'front', el, label: '', binds: true });
  }
  out[0] = { ...out[0], label: 'photo corners' } as Attach;
  return out;
}

/** Holders for a photo lying on its own: never tape. On the desk it lies loose; boards and fridges pin or magnet it. */
function photoHolds(ctx: Ctx, w: number, h: number, rate = 1): Attach[] {
  if (ctx.mount === 'table') return [];
  return attachments({ ...ctx, attachRate: ctx.attachRate * rate }, w, h, { allowTape: false, allowClip: false });
}

const polaroid: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const variant = rng.weighted(['classic', 'mini', 'wide'] as const, (v) => (v === 'classic' ? 3 : v === 'mini' ? 2 : 1.2));
  const V = {
    classic: { w: 212, h: 258, win: { x: 13, y: 13, w: 186, h: 186 }, r: 1.5, name: 'Instant photo (square)' },
    mini: { w: 150, h: 238, win: { x: 9, y: 15, w: 132, h: 178 }, r: 4, name: 'Instant photo (mini)' },
    wide: { w: 300, h: 240, win: { x: 13, y: 15, w: 274, h: 172 }, r: 4, name: 'Instant photo (wide)' },
  }[variant];
  const meta = pickPhoto(rng, variant === 'mini' ? 'port' : variant === 'wide' ? 'land' : 'any');
  const grade = rng.pick(['instant', 'instant', 'faded', 'none', 'expired', 'warm'] as const);
  const layer = div('layer');
  layer.appendChild(photoLater({ id: meta.id, grade, vignette: rng.range(0.15, 0.35), grain: rng.range(0.3, 0.7), leak: rng.chance(0.18), seed: rng.int(1, 1e6) }, V.win));
  layer.appendChild(div('develop', boxCss(V.win)));
  layer.appendChild(div('photo-edge', boxCss(V.win)));
  const f = penned(ctx, rng.pick(CAPTION_FONTS));
  const color = rng.pick([INKS.black, INKS.black, INKS.ballpoint, INKS.red]);
  const by = V.win.y + V.win.h + 5, bh = V.h - by - 5;
  const dated = rng.chance(0.3);
  layer.appendChild(
    fitInk(f, 24, color, { x: 14, y: by, w: V.w - 28 - (dated ? 44 : 0), h: bh }, [{ text: captionFor(rng, meta) }], { lineHeight: 1.05, drop: false, maxLines: 2 }, `display:flex;flex-direction:column;justify-content:center;transform:rotate(${rng.range(-3, 2).toFixed(1)}deg)`, 'caption'),
  );
  if (dated) layer.appendChild(ink(f, 13, color, `right:12px;top:${by + bh / 2 - 9}px;opacity:.85`, esc(rng.pick(DATES))));
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { radius: V.r },
    relief: { bend: rng.range(-2, 3), bendAngle: rng.range(0, 180), curl: rng.chance(0.3) ? { amount: rng.range(2, 5), corners: [rng.pick(['tl', 'tr', 'br', 'bl'] as const)] } : undefined },
    finish: { gloss: 0.12, edgeWear: rng.range(0, 0.3) },
    shadow: { softness: 3.5, strength: 1.05 },
  };
  const attach = photoHolds(ctx, V.w, V.h);
  const spec = motion(mo, [...developPhoto('.develop', m.range(2.2, 3.2)), ...writeOn('.caption', 0.9)]);
  return { w: V.w, h: V.h, rot: rng.range(-9, 9), paper: 'polaroid', look, ink: layer, attach, info: info(V.name, 'polaroid', [f.family], attach), motion: spec };
};

const photoNote: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const key = rng.pick(['construction-white', 'printer', 'pastel-light-cream', 'handmade-ivory', 'kraft-light', 'oatmeal', 'sketchbook-cream', 'kraft']);
  const w = rng.int(250, 290), h = rng.int(290, 340);
  const ways: [string, number][] =
    ctx.mount === 'board' ? [['pin', 3], ['clip', 2], ['binder', 1], ['tape', 1]] : ctx.mount === 'magnetic' ? [['magnet', 3], ['clip', 1], ['binder', 1], ['tape', 1]] : [['clip', 3], ['binder', 2], ['tape', 3]];
  const how = rng.weighted(ways, ([, wt]) => wt)[0];
  const meta = pickPhoto(rng);
  const layouts: NoteLayout[] = how === 'clip' ? ['hang', 'top', 'side'] : how === 'binder' ? ['hang'] : how === 'tape' ? ['corner', 'top', 'side'] : ['top', 'side', 'corner'];
  const L = layoutNote(rng, w, h, { aspect: clamp(meta.w / meta.h, 0.75, 1.5), layouts, pad: 18, minText: [84, 64] });
  const p = { ...L.photo };
  const border = rng.chance(0.6) ? rng.range(5, 8) : 0;
  const print = printAttach(rng, meta, p, { border });
  const attach: Attach[] = [];
  if (how === 'clip') attach.push(...clipped(rng, p, print, 'clip', L.layout === 'side' ? L.side : 0, w));
  else if (how === 'binder') attach.push(...clipped(rng, p, print, 'binder'));
  else if (how === 'tape') attach.push(print, ...photoTapes(rng, p), ...attachments({ ...ctx, attachRate: ctx.attachRate * 0.5 }, w, h, { allowClip: false, allowTape: false }));
  else {
    // a pin or magnet through the top of the print holds both
    const [x, y] = cornerOf(p, rng.range(-0.3, 0.3), -1 + 26 / p.h);
    const prop: PropSpec = how === 'pin' ? { kind: 'pushpin', color: rng.pick(PIN_COLORS), angle: rng.range(0, 360) } : { kind: 'magnet', color: rng.pick(MAGNET_COLORS) };
    attach.push(print, { type: 'prop', x, y, layer: 'front', prop, label: how === 'pin' ? 'push pin' : 'magnet' });
  }
  const layer = div('layer');
  const f = font(ctx, PEN);
  const color = inkFor(rng, key);
  const deco = mo ? ' nodeco' : '';
  const blocks: FitBlock[] = [{ text: captionFor(rng, meta), cls: 't' + deco, keep: true }, ...shuffled(rng, NOTES).slice(0, rng.int(2, 4)).map((t) => ({ text: t }))];
  // clips move the print to the card's edge: the text gets the space that frees up (or keeps its box)
  const text = how === 'clip' || how === 'binder' ? (freeRect({ x: 0, y: 0, w, h }, bounds(p), 18, 8, [84, 64]) ?? L.text) : L.text;
  layer.appendChild(fitInk(f, 19, color, text, blocks, { lineHeight: 1.2 }));
  if (rng.chance(0.15)) coffeeRing(rng, layer, w, h);
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { radius: 1 },
    relief: { bend: rng.range(-3, 4), bendAngle: rng.range(0, 180), wrinkles: rng.chance(0.2) ? 0.1 : 0 },
    finish: { edgeWear: rng.range(0, 0.5) },
  };
  const spec = motion(mo, underlineTitle(m, '.t', color));
  const name = { clip: 'paper clip', binder: 'binder clip', tape: 'taped', pin: 'pinned', magnet: 'magnet' }[how];
  return { w, h, rot: rng.range(-6, 6), paper: key, look, ink: layer, attach, info: info(`Photo note (${name}, ${L.layout})`, key, [f.family], attach), motion: spec };
};

const vintage: Maker = (ctx) => {
  const { rng } = ctx;
  const meta = pickPhoto(rng);
  const a = clamp(meta.w / meta.h, 0.72, 1.45);
  const long = rng.int(196, 236);
  const pw = a >= 1 ? long : long * a, ph = a >= 1 ? long / a : long;
  const b = rng.range(9, 13);
  const bottom = rng.chance(0.4) ? b + rng.range(12, 18) : b;
  const w = Math.round(pw + 2 * b), h = Math.round(ph + b + bottom);
  const layer = div('layer');
  const grade = rng.pick(['sepia', 'bw', 'bw', 'faded'] as const);
  layer.appendChild(photoLater({ id: meta.id, grade, vignette: rng.range(0.3, 0.5), grain: rng.range(0.5, 0.9), seed: rng.int(1, 1e6) }, { x: b, y: b, w: w - 2 * b, h: h - b - bottom }));
  const fonts: string[] = [];
  if (bottom > b) {
    const f = rng.pick(TYPEWRITER);
    fonts.push(f.family);
    layer.appendChild(ink(f, 9, '#6b5b48', `left:0;right:0;bottom:${(bottom - 10) / 2}px;text-align:center;letter-spacing:.14em;opacity:.8`, esc(rng.pick(PHOTO_DATES))));
  }
  const scallop = rng.chance(0.65);
  const e = { kind: 'wavy' as const, amount: 1.3, scale: 5.5 };
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: scallop ? { edges: { top: e, right: e, bottom: e, left: e }, rim: 0 } : { radius: 0.6 },
    relief: { bend: rng.range(-3, 3), bendAngle: rng.range(0, 180), cockle: rng.range(0, 0.4), curl: rng.chance(0.4) ? { amount: rng.range(2, 5), corners: [rng.pick(['tl', 'tr', 'br', 'bl'] as const)] } : undefined },
    finish: { aging: rng.range(0.25, 0.6), edgeWear: rng.range(0.3, 0.7), gloss: 0.05 },
    shadow: { softness: 3.5 },
  };
  const attach = photoHolds(ctx, w, h);
  return { w, h, rot: rng.range(-10, 10), paper: 'photo-matte', look, ink: layer, attach, info: info(`Vintage print (${grade}${scallop ? ', scalloped' : ''})`, 'photo-matte', fonts, attach) };
};

const tear: Maker = (ctx) => {
  const { rng } = ctx;
  const meta = pickPhoto(rng, rng.chance(0.7) ? 'land' : 'any');
  const w = rng.int(210, 250);
  const ph = Math.round(w / clamp(meta.w / meta.h, 0.9, 1.6));
  const h = ph + rng.int(54, 66);
  const news = rng.chance(0.4);
  const key = news ? 'newsprint' : 'photo-gloss';
  const layer = div('layer');
  // the photo bleeds off the page; the tear shows the paper's pale core
  layer.appendChild(photoLater({ id: meta.id, grade: news ? 'faded' : 'none', halftone: news, grain: news ? 0 : 0.2, seed: rng.int(1, 1e6) }, { x: -6, y: -6, w: w + 12, h: ph + 6 }));
  const f = font(ctx, MONO.filter((x) => ['IBM Plex Mono', 'Space Mono', 'Courier Prime', 'JetBrains Mono'].includes(x.family)), false);
  const caption = cap(captionFor(rng, meta));
  layer.appendChild(
    fitInk(f, 10, '#1f1e22', { x: 16, y: ph + 8, w: w - 32, h: h - ph - 20 }, [{ text: caption, weight: '600', keep: true }, { text: `Photograph: ${rng.pick(NAMES)}`, scale: 0.8, gap: 0.4, cls: 'dim', keep: true }], { lineHeight: 1.25, drop: false }),
  );
  const t = () => torn(rng.range(4, 8), rng.range(14, 26));
  const edges: Partial<Record<'top' | 'right' | 'bottom' | 'left', ReturnType<typeof torn>>> = { top: t(), right: t(), bottom: t(), left: t() };
  delete edges[rng.pick(['top', 'right', 'bottom', 'left'] as const)];
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { edges, rim: news ? 2 : 2.8 },
    // photo stock: smooth cockle, not faceted crumples (glossy facets read as low-poly triangles)
    relief: { cockle: rng.range(0.25, 0.6), cockleSize: rng.range(70, 120), bend: rng.range(-3, 3), bendAngle: rng.range(0, 180) },
    finish: { gloss: news ? 0 : 0.15, aging: news ? rng.range(0, 0.3) : 0 },
  };
  const attach = photoHolds(ctx, w, h);
  return { w, h, rot: rng.range(-12, 12), paper: key, look, ink: layer, attach, info: info(news ? 'Torn newspaper photo (halftone)' : 'Torn magazine photo', key, [f.family], attach) };
};

const roundPrint: Maker = (ctx) => {
  const { rng } = ctx;
  const meta = pickPhoto(rng);
  const a = clamp(meta.w / meta.h, 0.72, 1.5);
  const long = rng.int(200, 250);
  const w = Math.round(a >= 1 ? long : long * a), h = Math.round(a >= 1 ? long / a : long);
  const layer = div('layer');
  const stamp = rng.chance(0.3) ? rng.pick(CAMERA_STAMPS) : undefined;
  layer.appendChild(photoLater({ id: meta.id, grade: rng.pick(['none', 'warm', 'none', 'faded'] as const), stamp, vignette: rng.range(0.1, 0.2), grain: rng.range(0.1, 0.35), leak: !!stamp && rng.chance(0.4), seed: rng.int(1, 1e6) }, { x: 0, y: 0, w, h }));
  const look: SheetLook = { seed: rng.int(1, 1e6), shape: { radius: rng.int(8, 14) }, relief: { bend: rng.range(-3, 3), bendAngle: rng.range(0, 180) }, finish: { gloss: 0.45 }, shadow: { softness: 3, strength: 1 } };
  const attach = photoHolds(ctx, w, h);
  return { w, h, rot: rng.range(-10, 10), paper: 'photo-gloss', look, ink: layer, attach, info: info(stamp ? 'Rounded print (date stamp)' : 'Rounded print', 'photo-gloss', [], attach) };
};

const album: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const w = rng.int(280, 310), h = rng.int(350, 390);
  const key = rng.pick(['construction-black', 'pastel-black', 'kraft', 'handmade-ivory', 'oatmeal']);
  const dark = isDark(key);
  const cornerColor = dark ? rng.pick(['#d9c48f', '#e8e4da', '#1d1c1f']) : rng.pick(['#1d1c1f', '#1d1c1f', '#7a2420']);
  const two = rng.chance(0.6);
  const regions: Box[] = two ? [{ x: 0, y: 0, w, h: h / 2 }, { x: 0, y: h / 2, w, h: h / 2 }] : [{ x: 0, y: 0, w, h }];
  const layer = div('layer');
  const f = font(ctx, PEN);
  const color = inkFor(rng, key, ['black', 'sepia', 'ballpoint']);
  const attach: Attach[] = [];
  const used = new Set<string>();
  regions.forEach((region, i) => {
    let meta = pickPhoto(rng);
    if (used.has(meta.id)) meta = PHOTOS.find((p) => !used.has(p.id))!;
    used.add(meta.id);
    const L = layoutNote(rng, w, h, { aspect: clamp(meta.w / meta.h, 0.75, 1.45), layouts: two ? ['side'] : ['side', 'top'], region, pad: 20, gap: 12, minText: [70, 36] });
    const p = L.photo;
    attach.push(printAttach(rng, meta, p, { border: rng.chance(0.7) ? rng.range(5, 8) : 0, grade: rng.pick(['none', 'faded', 'warm', 'bw', 'sepia'] as const) }), ...photoCorners(p, cornerColor));
    const blocks: FitBlock[] = [{ text: captionFor(rng, meta), keep: true }];
    if (rng.chance(0.5)) blocks.push({ text: rng.pick([...DATES, ...PHOTO_DATES]), scale: 0.7, gap: 0.3, cls: 'dim', keep: true });
    layer.appendChild(fitInk(f, 20, color, L.text, blocks, { lineHeight: 1.15, drop: false }, 'display:flex;flex-direction:column;justify-content:center;text-align:center', `caption c${i}`));
  });
  attach.push(...attachments(ctx, w, h, { allowClip: false }));
  const look: SheetLook = { seed: rng.int(1, 1e6), shape: { radius: 1 }, relief: { bend: rng.range(-2, 3), bendAngle: 90, wrinkles: rng.range(0, 0.06) }, finish: { edgeWear: rng.range(0.1, 0.5), aging: dark ? 0 : rng.range(0, 0.3) } };
  const spec = motion(mo, writeOn('.caption', 0.8), { stagger: 0.2 });
  return { w, h, rot: rng.range(-5, 5), paper: key, look, ink: layer, attach, info: info(`Album page (${regions.length} photo${regions.length > 1 ? 's' : ''})`, key, [f.family], attach), motion: spec };
};

const booth: Maker = (ctx) => {
  const { rng } = ctx;
  const w = rng.int(96, 106), fw = w - 16, fh = Math.round(fw * 0.8);
  const n = rng.pick([3, 4, 4]), gap = 6, top = 8, bottom = rng.int(22, 30);
  const h = top + n * fh + (n - 1) * gap + bottom;
  const grade = rng.chance(0.7) ? ('bw' as const) : ('sepia' as const);
  const layer = div('layer');
  shuffled(rng, PHOTOS)
    .slice(0, n)
    .forEach((meta, i) => layer.appendChild(photoLater({ id: meta.id, grade, vignette: 0.3, grain: 0.6, seed: rng.int(1, 1e6) }, { x: 8, y: top + i * (fh + gap), w: fw, h: fh })));
  const f = rng.pick(MONO.filter((x) => ['Space Mono', 'IBM Plex Mono', 'Courier Prime'].includes(x.family)));
  layer.appendChild(ink(f, 7.5, '#4a4640', `left:0;right:0;bottom:${(bottom - 9) / 2}px;text-align:center;letter-spacing:.2em;opacity:.75`, esc(`PHOTOMATIC · ${rng.pick(DATES).toUpperCase()}`)));
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { radius: 0.8 },
    relief: { bend: rng.range(2, 6), bendAngle: 90, curl: rng.chance(0.4) ? { amount: rng.range(2, 5), sides: [rng.pick(['top', 'bottom'] as const)] } : undefined },
    finish: { gloss: 0.15, edgeWear: rng.range(0, 0.3) },
  };
  const attach = photoHolds(ctx, w, h);
  return { w, h, rot: rng.range(-12, 12), paper: 'photo-matte', look, ink: layer, attach, info: info(`Photo-booth strip (${n} frames, ${grade})`, 'photo-matte', [f.family], attach) };
};

const filmStrip: Maker = (ctx) => {
  const { rng } = ctx;
  const m = rng.fork(), mo = m.chance(ctx.motion);
  const h = 112, fh = 70, fw = 104, gap = 8;
  const n = rng.int(3, 4), x0 = rng.int(6, 14);
  const w = x0 * 2 + n * fw + (n - 1) * gap;
  const pitch = 14, count = Math.floor((w - 7) / pitch) + 1;
  const layer = div('layer');
  const grade = rng.pick(['none', 'warm', 'bw', 'faded'] as const);
  const fy = (h - fh) / 2;
  const frames: Box[] = [];
  shuffled(rng, PHOTOS)
    .slice(0, n)
    .forEach((meta, i) => {
      const box = { x: x0 + i * (fw + gap), y: fy, w: fw, h: fh };
      frames.push(box);
      layer.appendChild(photoLater({ id: meta.id, grade, vignette: 0.2, grain: 0.5, seed: rng.int(1, 1e6) }, box));
    });
  const f = rng.pick(MONO.filter((x) => ['Space Mono', 'IBM Plex Mono', 'JetBrains Mono'].includes(x.family)));
  const edge = '#e98b2f';
  const first = rng.int(4, 30);
  layer.appendChild(ink(f, 7, edge, `left:${x0 + 4}px;top:${fy - 11}px;letter-spacing:.18em;opacity:.85`, esc(rng.pick(FILM_STOCKS))));
  frames.forEach((b, i) => layer.appendChild(ink(f, 7, edge, `left:${b.x + 4}px;top:${b.y + b.h + 2}px;letter-spacing:.1em;opacity:.85`, `${first + i}&nbsp;&nbsp;▸${first + i}A`)));
  const pick = rng.int(0, n - 1);
  layer.appendChild(div('pick', boxCss(frames[pick])));
  const look: SheetLook = {
    seed: rng.int(1, 1e6),
    shape: { holeRows: [{ x: 7, y: 7, dx: pitch, dy: 0, count, r: 2.8 }, { x: 7, y: h - 7, dx: pitch, dy: 0, count, r: 2.8 }] },
    relief: { bend: rng.range(-4, 4), bendAngle: 0, curl: rng.chance(0.4) ? { amount: rng.range(2, 6), sides: [rng.pick(['left', 'right'] as const)] } : undefined },
    finish: { opacity: 0.95, gloss: 0.55 },
    shadow: { strength: 0.85 },
  };
  const attach = photoHolds(ctx, w, h, 0.6);
  const spec = motion(mo, markFrame(m, '.pick', m.pick(['#e8473b', '#f2f0e8', '#f2d03a'])), { delay: 0.3 });
  return { w, h, rot: rng.range(-14, 14), paper: 'film', look, ink: layer, attach, info: info(`Film strip (${n} frames, ${grade})`, 'film', [f.family], attach), motion: spec };
};

export interface Kind {
  id: string;
  label: string;
  weight: number;
  make: Maker;
}

export const KINDS: Kind[] = [
  { id: 'sticky', label: 'Sticky notes', weight: 3, make: sticky },
  { id: 'index', label: 'Index cards', weight: 2, make: indexCard },
  { id: 'notebook', label: 'Notebook pages', weight: 1.6, make: notebook },
  { id: 'napkin', label: 'Napkin sketches', weight: 1.4, make: napkin },
  { id: 'scrap', label: 'Paper scraps', weight: 2, make: scrap },
  { id: 'graph', label: 'Graph paper', weight: 1.2, make: graph },
  { id: 'biz', label: 'Business cards', weight: 1.3, make: bizcard },
  { id: 'quote', label: 'Quote cards', weight: 1.1, make: quote },
  { id: 'tag', label: 'Shipping tags', weight: 1, make: tag },
  { id: 'receipt', label: 'Receipts', weight: 1, make: receipt },
  { id: 'ticket', label: 'Ticket stubs', weight: 1, make: ticket },
  { id: 'memo', label: 'Typed letters', weight: 1, make: memo },
  { id: 'watercolor', label: 'Watercolor swatches', weight: 0.9, make: watercolor },
  { id: 'clipping', label: 'Newspaper clippings', weight: 0.8, make: clipping },
  { id: 'stamp', label: 'Postage stamps', weight: 0.9, make: stamp },
  { id: 'tracing', label: 'Tracing paper', weight: 0.7, make: tracing },
  { id: 'tapelabel', label: 'Tape labels', weight: 0.8, make: tapeLabel },
  { id: 'polaroid', label: 'Instant photos', weight: 1.2, make: polaroid },
  { id: 'photonote', label: 'Photo notes', weight: 1.1, make: photoNote },
  { id: 'print', label: 'Rounded prints', weight: 0.8, make: roundPrint },
  { id: 'vintage', label: 'Vintage prints', weight: 0.8, make: vintage },
  { id: 'tear', label: 'Magazine tears', weight: 0.7, make: tear },
  { id: 'album', label: 'Album pages', weight: 0.6, make: album },
  { id: 'booth', label: 'Photo-booth strips', weight: 0.6, make: booth },
  { id: 'film', label: 'Film strips', weight: 0.6, make: filmStrip },
];

// Demo content and attachments wrap the same public paper recipes used by consumers.
for (const kind of KINDS) {
  const make = kind.make;
  kind.make = (ctx) => {
    const preset = getCardPreset(kind.id as CardPresetId);
    const plan = make(ctx);
    return { ...plan, preset: preset.id, look: { ...preset.sheet, ...plan.look } };
  };
}
