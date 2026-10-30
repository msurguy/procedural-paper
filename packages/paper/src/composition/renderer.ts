import { renderPaperLayers } from '../dom';
/**
 * Turns card plans into DOM + pixels. Every sheet and prop is rendered with
 * the light expressed in its own (rotated) frame, so after CSS rotation all
 * shadows on the desk fall the same way.
 *
 *   .card                     positioned + rotated (peel.ts owns the transform)
 *     .shadow                 cast shadow: contact canvas + pre-blurred lifted canvas
 *     .back                   attachments under the paper (paper-clip loop, tag string)
 *     .paper (isolated)       base canvas · ink (masked to the sheet) · shade canvas (hard-light) · sheen
 *     .front                  pins, magnets, tape, clips
 */
import { mergeParams, type PaperParams, type SheetOutput } from '../index';
import type { Attach, CardPlan, SheetLook } from './scene';
import { PaperRenderer, stockParams as paperParams } from '../index';
import { runFits } from './fit';
import { createCordRenderer } from './cords';
import { EXTENT, createPropRenderer, type PropKind, type PropSpec } from './props';
import type { createPhotoRenderer } from './photos';

export type HolderKind = 'free' | 'adhesive' | 'taped' | 'pinned' | 'magnetic' | 'hung';
export interface HolderPoint {
  /** Card-local position (px). */
  x: number;
  y: number;
  /** The attachment's sprite, if it has one of its own. */
  el?: HTMLElement;
  /** Tape: on-card angle and length. */
  angle?: number;
  len?: number;
}
export interface Holder {
  kind: HolderKind;
  points: HolderPoint[];
}
export type Thickness = 'thin' | 'normal' | 'thick';
export interface BuiltCard {
  el: HTMLElement;
  paper: HTMLElement;
  /** Cast shadow layer (moves on its own when the card is lifted). */
  shadow: HTMLElement;
  /** Highlight gradient for the peel curl (opacity 0 at rest). */
  sheen: HTMLElement;
  holder: Holder;
  thickness: Thickness;
  /** Bendable copy of the layers for the pickup curl (built on first grab, dropped on re-render). */
  copy: Promise<HTMLElement> | null;
  /** On-screen rotation the pixels were lit for (null until rendered). */
  litFor: number | null;
  /** Render (or re-render) for an on-screen rotation; defaults to the plan's. */
  render(angle?: number): Promise<void>;
}
export interface BuiltProp {
  el: HTMLElement;
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** Soft shadow for when the prop is lifted (hidden at rest). */
  shadow: HTMLElement;
  /** Physical height (CSS px): how far it has to be lifted, how heavy it feels. */
  height: number;
}
export function createSceneRenderer(options: { renderer: PaperRenderer; light: { azimuth: number; elevation: number }; grain: () => number; photos: ReturnType<typeof createPhotoRenderer>; pixelRatio?: () => number; onPrepared?: (plan: CardPlan, built: BuiltCard, angle: number) => void }) {
const props = createPropRenderer(), cords = createCordRenderer();
const LIGHT = options.light;
const getRenderer = () => options.renderer;
const { renderProp } = props; const { renderCord } = cords;
const { preloadPhotos, renderPhoto, runPhotos } = options.photos;
const dpr = () => options.pixelRatio?.() ?? Math.min(2, window.devicePixelRatio || 1);

/** Shadow offset (CSS px) for an object lying flat, in screen space. */
const SHADOW = { x: 1.5, y: 4 };
/** Blur (CSS px) of the shadow a lifted sheet casts. */
const LIFT_BLUR = 9;

const rot = (x: number, y: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [c * x - s * y, s * x + c * y];
};

/** Unit vector (screen space) a lifted object's shadow moves along: away from the light. */
function shadowDir(): [number, number] {
  const [x, y] = rot(SHADOW.x, SHADOW.y, LIGHT.azimuth - 225);
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** Paper params with the desk's grain scale applied (densities scale 1/t rather than 1/t² so small papers stay calm). */
function grainParams(key: string, overrides?: Parameters<typeof mergeParams>[1]): PaperParams {
  const base = overrides ? mergeParams(paperParams(key), overrides) : paperParams(key);
  const t = options.grain();
  return {
    ...base,
    scale: base.scale * t,
    fibers: { ...base.fibers, density: base.fibers.density / t },
    specks: { ...base.specks, density: base.specks.density / t },
  };
}

function sheetCanvas(data: Uint8ClampedArray, W: number, H: number, k: number, cls: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = cls;
  c.width = W;
  c.height = H;
  c.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
  c.style.width = `${W / k}px`;
  c.style.height = `${H / k}px`;
  return c;
}

/** A blurred copy of a canvas' alpha, in black, with `pad` CSS px of room for the blur. */
function blurredShadow(src: HTMLCanvasElement, k: number, blur: number, cls: string): { canvas: HTMLCanvasElement; pad: number } {
  const pad = Math.ceil(blur * 2);
  const c = document.createElement('canvas');
  c.className = cls;
  c.width = src.width + 2 * pad * k;
  c.height = src.height + 2 * pad * k;
  const ctx = c.getContext('2d')!;
  ctx.filter = `blur(${blur * k}px)`;
  ctx.drawImage(src, pad * k, pad * k);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  c.style.width = `${c.width / k}px`;
  c.style.height = `${c.height / k}px`;
  return { canvas: c, pad };
}

/** Render a sheet whose total on-screen rotation is `angle` degrees. */
function sheetInputs(key: string, overrides: CardPlan['params'], look: SheetLook, w: number, h: number, angle: number) {
  const params = grainParams(key, overrides);
  params.lighting = { ...params.lighting, azimuth: LIGHT.azimuth - angle, elevation: LIGHT.elevation };
  // the shadow is cast in screen space; express it in the sheet's frame
  const sh = look.shadow === false ? false : { ...(look.shadow ?? {}) };
  if (sh) {
    const scale = Math.tan(((90 - LIGHT.elevation) * Math.PI) / 180) / Math.tan((42 * Math.PI) / 180);
    const ox = (sh.offsetX ?? SHADOW.x) * scale, oy = (sh.offsetY ?? SHADOW.y) * scale;
    // rotate the default down-right offset with the light, then into the sheet frame
    const [gx, gy] = rot(ox, oy, LIGHT.azimuth - 225);
    [sh.offsetX, sh.offsetY] = rot(gx, gy, -angle);
  }
  const k = dpr();
  return { params, spec: { ...look, width: w, height: h, pixelRatio: k, shadow: sh as SheetLook['shadow'] }, k };
}

function renderSheetFor(key: string, overrides: CardPlan['params'], look: SheetLook, w: number, h: number, angle: number, outputs: SheetOutput[]) {
  const { params, spec, k } = sheetInputs(key, overrides, look, w, h, angle);
  return { res: getRenderer().renderSheet(params, spec, outputs), k };
}

// ---------------------------------------------------------------- holders

/** How a card is held down, which decides how it peels off and goes back on. */








const PIN_KINDS: PropKind[] = ['pushpin', 'mappin', 'thumbtack', 'staple'];
const MAGNET_KINDS: PropKind[] = ['magnet', 'magnet-neo', 'magnet-bar'];
const CLIP_KINDS: PropKind[] = ['binder', 'paperclip'];

function thicknessOf(paper: string): Thickness {
  if (paper.startsWith('card') || paper === 'chipboard' || paper === 'polaroid') return 'thick';
  if (['napkin', 'tracing', 'thermal', 'newsprint', 'newsprint-old', 'clear-tape', 'washi', 'masking'].includes(paper)) return 'thin';
  return 'normal';
}

function deriveHolder(plan: CardPlan, sprites: Map<Attach, HTMLElement>): Holder {
  const pts = (pred: (a: Attach) => boolean): HolderPoint[] =>
    plan.attach.filter((a) => !a.binds && pred(a)).map((a) => {
      const el = sprites.get(a);
      if (a.type === 'sheet') return { x: a.x, y: a.y, el, angle: a.angle, len: a.w };
      if (a.type === 'prop') return { x: a.x, y: a.y, el };
      if (a.type === 'photo') return { x: a.cx, y: a.cy, el };
      return { x: plan.w / 2, y: 28, el };
    });
  const pins = pts((a) => a.type === 'prop' && PIN_KINDS.includes(a.prop.kind));
  if (pins.length) return { kind: 'pinned', points: pins };
  const magnets = pts((a) => a.type === 'prop' && MAGNET_KINDS.includes(a.prop.kind));
  if (magnets.length) return { kind: 'magnetic', points: magnets };
  const tapes = pts((a) => a.type === 'sheet' && a.label.endsWith('tape'));
  if (tapes.length) return { kind: 'taped', points: tapes };
  const clips = pts((a) => a.type === 'prop' && CLIP_KINDS.includes(a.prop.kind) && a.layer === 'front');
  if (clips.length) return { kind: 'hung', points: clips };
  const cords = pts((a) => a.type === 'cord');
  if (cords.length) return { kind: 'hung', points: cords };
  if (plan.paper === 'sticky') return { kind: 'adhesive', points: [{ x: plan.w / 2, y: plan.h * 0.09 }] };
  return { kind: 'free', points: [] };
}

// ---------------------------------------------------------------- cards



function buildCard(plan: CardPlan): BuiltCard {
  const el = document.createElement('div');
  el.className = 'card pc-card';
  el.style.width = `${plan.w}px`;
  el.style.height = `${plan.h}px`;
  const shadow = document.createElement('div');
  shadow.className = 'shadow';
  const back = document.createElement('div');
  back.className = 'back';
  const paper = document.createElement('div');
  paper.className = 'paper';
  const front = document.createElement('div');
  front.className = 'front';
  const sheen = document.createElement('div');
  sheen.className = 'sheen';
  el.append(shadow, back, paper, front);

  const built: BuiltCard = { el, paper, shadow, sheen, holder: { kind: 'free', points: [] }, thickness: thicknessOf(plan.paper), copy: null, litFor: null, render: async () => {} };
  let prepared = false;
  built.render = async (angle = plan.rot) => {
    paper.replaceChildren();
    back.replaceChildren();
    front.replaceChildren();
    shadow.replaceChildren();
    built.copy = null;
    built.litFor = angle;
    // size text to its boxes (pretext) before anything is shown
    if (plan.ink) await runFits(plan.ink);
    if (!prepared) { options.onPrepared?.(plan, built, angle); prepared = true; }
    // photos: draw the ones printed on the card, load the ones attached to it
    if (plan.ink) await runPhotos(plan.ink);
    await preloadPhotos(plan.attach.flatMap((a) => (a.type === 'photo' ? [a.photo] : [])));
    const { params, spec, k } = sheetInputs(plan.paper, plan.params, plan.look, plan.w, plan.h, angle);
    const layers = renderPaperLayers(getRenderer(), params, spec);
    const contact = layers.shadow; contact.className = 'contact';
    const lifted = blurredShadow(contact, k, LIFT_BLUR, 'lifted');
    lifted.canvas.style.left = `${parseFloat(contact.style.left) - lifted.pad}px`;
    lifted.canvas.style.top = `${parseFloat(contact.style.top) - lifted.pad}px`;
    shadow.append(contact, lifted.canvas);
    layers.base.className = 'base'; layers.shade.className = 'shade';
    paper.append(layers.base);
    if (plan.ink) paper.append(plan.ink);
    paper.append(layers.shade, sheen);
    for (const target of [plan.ink, sheen]) {
      if (!target) continue;
      Object.assign(target.style, { maskImage: layers.mask, webkitMaskImage: layers.mask, maskPosition: layers.maskPosition, maskSize: layers.maskSize, maskRepeat: 'no-repeat' });
    }
    const sprites = new Map<Attach, HTMLElement>();
    for (const a of plan.attach) {
      const s = attach(a, angle, a.type === 'cord' ? front : a.layer === 'back' ? back : front, back);
      if (s) sprites.set(a, s);
    }
    built.holder = deriveHolder(plan, sprites);
    el.classList.add('ready');
  };
  return built;
}

/** Returns the attachment's main sprite (the one effects animate), if any. */
function attach(a: Attach, cardRot: number, layer: HTMLElement, back: HTMLElement): HTMLElement | null {
  if (a.type === 'cord') {
    let main: HTMLElement | null = null;
    for (const part of ['back', 'front'] as const) {
      const s = renderCord(a.spec, part, dpr(), LIGHT.azimuth - cardRot, LIGHT.elevation);
      if (!s) continue;
      s.canvas.className = 'prop-sprite';
      s.canvas.style.left = `${-s.ox}px`;
      s.canvas.style.top = `${-s.oy}px`;
      (part === 'back' ? back : layer).appendChild(s.canvas);
      if (part === 'front') main = s.canvas;
    }
    return main;
  }
  if (a.type === 'html') {
    layer.appendChild(a.el);
    return a.el;
  }
  if (a.type === 'prop') {
    const s = renderProp({ ...a.prop, azimuth: LIGHT.azimuth - cardRot, elevation: LIGHT.elevation }, dpr());
    s.canvas.className = 'prop-sprite';
    s.canvas.style.left = `${a.x - s.ox}px`;
    s.canvas.style.top = `${a.y - s.oy}px`;
    s.canvas.style.transformOrigin = `${s.ox}px ${s.oy}px`;
    layer.appendChild(s.canvas);
    return s.canvas;
  }
  if (a.type === 'photo') return attachPhoto(a, cardRot, layer);
  const { res, k } = renderSheetFor(a.paper, a.params, a.look, a.w, a.h, cardRot + a.angle, ['color']);
  const c = sheetCanvas(res.maps.color!.data, res.width, res.height, k, 'tape');
  c.style.left = `${a.x - res.width / k / 2}px`;
  c.style.top = `${a.y - res.height / k / 2}px`;
  c.style.transform = `rotate(${a.angle}deg)`;
  layer.appendChild(c);
  return c;
}

/**
 * A photo print on a card: its own small sheet (so it bends, shines and casts
 * a shadow on the card like paper does) with the graded photo composited
 * between the sheet's base and shade, all on one canvas.
 */
function attachPhoto(a: Extract<Attach, { type: 'photo' }>, cardRot: number, layer: HTMLElement): HTMLElement {
  const { res, k } = renderSheetFor(a.paper, a.params, a.look, a.w, a.h, cardRot + a.angle, ['base', 'shade', 'shadow']);
  const m = res.margin;
  const base = sheetCanvas(res.maps.base!.data, res.width, res.height, k, '');
  const shade = sheetCanvas(res.maps.shade!.data, res.width, res.height, k, '');
  const out = document.createElement('canvas');
  out.width = res.width;
  out.height = res.height;
  const g = out.getContext('2d')!;
  g.drawImage(base, 0, 0);
  const ph = renderPhoto(a.photo, a.window.w, a.window.h, k);
  g.globalCompositeOperation = 'source-atop';
  g.drawImage(ph, m + a.window.x * k, m + a.window.y * k);
  g.globalCompositeOperation = 'hard-light';
  g.drawImage(shade, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(base, 0, 0);
  const shadow = sheetCanvas(res.maps.shadow!.data, res.width, res.height, k, 'tape photo-shadow');
  const place = (c: HTMLCanvasElement) => {
    c.style.left = `${a.cx - res.width / k / 2}px`;
    c.style.top = `${a.cy - res.height / k / 2}px`;
    c.style.width = `${res.width / k}px`;
    c.style.height = `${res.height / k}px`;
    c.style.transform = `rotate(${a.angle}deg)`;
    return c;
  };
  out.className = 'tape photo-print';
  layer.append(place(shadow), place(out));
  return out;
}

// ---------------------------------------------------------------- props



/** A loose prop lying on the desk (rendered in screen space, no CSS rotation). */
function buildProp(spec: PropSpec): BuiltProp {
  const s = renderProp({ ...spec, azimuth: LIGHT.azimuth, elevation: LIGHT.elevation }, dpr());
  const el = document.createElement('div');
  el.className = 'prop';
  el.style.width = `${s.w}px`;
  el.style.height = `${s.h}px`;
  s.canvas.className = 'prop-sprite';
  const k = dpr();
  const lifted = blurredShadow(s.canvas, k, 7, 'lifted');
  const shadow = document.createElement('div');
  shadow.className = 'shadow';
  lifted.canvas.style.left = `${-lifted.pad}px`;
  lifted.canvas.style.top = `${-lifted.pad}px`;
  shadow.appendChild(lifted.canvas);
  el.append(shadow, s.canvas, hitShape(s.canvas, s.w, s.h));
  return { el, ox: s.ox, oy: s.oy, w: s.w, h: s.h, shadow, height: EXTENT[spec.kind][1] };
}

/** Grid step of a prop's hit shape (CSS px); also how far it reaches past the object, so thin things stay easy to grab. */
const HIT_CELL = 2;

/**
 * The prop's own outline as an SVG hit area. The element is a box big enough for the
 * rotated object and its cast shadow, so it ignores pointers (style.css) and only this
 * shape takes them: cells where the sprite is opaque (the shadow is at most 42% alpha),
 * grown by one cell, as one path of row runs. Being DOM, it follows every transform.
 */
function hitShape(sprite: HTMLCanvasElement, w: number, h: number): SVGSVGElement {
  const { data } = sprite.getContext('2d')!.getImageData(0, 0, sprite.width, sprite.height);
  const kx = sprite.width / w, ky = sprite.height / h;
  const cols = Math.ceil(w / HIT_CELL), rows = Math.ceil(h / HIT_CELL);
  const solid = new Uint8Array(cols * rows);
  for (let y = 0; y < sprite.height; y++)
    for (let x = 0; x < sprite.width; x++)
      if (data[(y * sprite.width + x) * 4 + 3] > 128) solid[Math.floor(y / ky / HIT_CELL) * cols + Math.floor(x / kx / HIT_CELL)] = 1;
  const on = (c: number, r: number) => {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && solid[rr * cols + cc]) return true;
      }
    return false;
  };
  let d = '';
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!on(c, r)) continue;
      const c0 = c;
      while (c + 1 < cols && on(c + 1, r)) c++;
      d += `M${c0 * HIT_CELL} ${r * HIT_CELL}h${(c - c0 + 1) * HIT_CELL}v${HIT_CELL}h${-(c - c0 + 1) * HIT_CELL}z`;
    }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'prop-hit');
  svg.setAttribute('width', `${w}`);
  svg.setAttribute('height', `${h}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

return { buildCard, buildProp, shadowDir, grainParams, dpr, dispose() { props.dispose(); cords.dispose(); } };
}
