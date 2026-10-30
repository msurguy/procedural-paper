import { compositionFor } from './composition-capture';
import { publishState } from '../bridge';
import './style.css';
import { luminance, parseColor } from 'procedural-paper';
import { KINDS, type CardPlan, type Mood, type Mount } from './cards';
import { loadFonts } from './fonts';
import { PAPERS, paperBase, rendererBackend, setTextureScale, stats } from './papers';
import { deskTexture } from './surfaces';
import type { PropKind, PropSpec } from './props';
import { createPeel, type Body, type PinRef } from './peel';
import { buildCard, buildProp, LIGHT, type BuiltCard } from './render';
import { prepareMotion, resetMotionBudget, type CardMotion } from './motion';
import { enablePen, PEN_FONTS, penFontAsFont, setPen } from './handwriting';
import { makeRng, type Rng } from './rng';
import { createTimeline } from './timeline';

loadFonts();

/** `friction` 0..1: how far a flicked sheet slides (felt grips, a cutting mat lets it glide). */
const DESKS: { id: string; label: string; mount: Mount; cls?: string; zoom?: number; friction: number }[] = [
  { id: 'oak', label: 'Oak desk', mount: 'table', zoom: 2, friction: 0.5 },
  { id: 'walnut', label: 'Walnut desk', mount: 'table', zoom: 2, friction: 0.5 },
  { id: 'plywood', label: 'Plywood bench', mount: 'table', zoom: 2, friction: 0.55 },
  { id: 'cutting-mat', label: 'Cutting mat', mount: 'table', cls: 'mat', friction: 0.35 },
  { id: 'cork', label: 'Cork board', mount: 'board', friction: 0.7 },
  { id: 'pegboard', label: 'Pegboard', mount: 'board', cls: 'pegs', friction: 0.6 },
  { id: 'felt', label: 'Felt board', mount: 'board', friction: 0.9 },
  { id: 'steel', label: 'Magnetic steel', mount: 'magnetic', zoom: 2, friction: 0.45 },
  { id: 'concrete', label: 'Concrete', mount: 'table', zoom: 1.4, friction: 0.75 },
  { id: 'kraft', label: 'Kraft paper', mount: 'table', friction: 0.6 },
  { id: 'chipboard', label: 'Chipboard', mount: 'table', friction: 0.65 },
  { id: 'handmade-navy', label: 'Navy handmade', mount: 'table', friction: 0.7 },
  { id: 'construction-black', label: 'Black card', mount: 'table', friction: 0.6 },
];

type Layout = 'scatter' | 'grid';
interface State {
  seed: number;
  count: number;
  layout: Layout;
  mood: Mood;
  desk: string;
  grain: number;
  kinds: string[];
  attach: number;
  props: boolean;
  /** Kind / paper / font captions under each card in grid layout. */
  labels: boolean;
  light: number;
  /** Content motion (brush annotations, write-on, draw-on) on some cards. */
  motion: boolean;
  /** Write handwriting with Tegaki pen strokes (lazy-loaded). */
  pen: boolean;
  /** Pen font id for every handwritten card, or '' to match each card's own face. */
  penFont: string;
}

const state: State = {
  seed: 1,
  count: 28,
  layout: 'scatter',
  mood: 'mix',
  desk: 'oak',
  grain: 0.7,
  kinds: KINDS.map((k) => k.id),
  attach: 0.55,
  props: true,
  labels: true,
  light: 225,
  motion: true,
  pen: false,
  penFont: '',
};

// ---------------------------------------------------------------- url state

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const num = (k: string, d: number, lo: number, hi: number) => (q.has(k) && Number.isFinite(+q.get(k)!) ? Math.min(hi, Math.max(lo, +q.get(k)!)) : d);
  state.seed = num('s', state.seed, 0, 1e9);
  state.count = num('n', state.count, 4, 80);
  state.grain = num('g', state.grain, 0.4, 1.4);
  state.attach = num('a', state.attach, 0, 1);
  state.light = num('L', state.light, 0, 360);
  if (q.get('l') === 'grid' || q.get('l') === 'scatter') state.layout = q.get('l') as Layout;
  if (['mix', 'hand', 'mono'].includes(q.get('m') ?? '')) state.mood = q.get('m') as Mood;
  if (DESKS.some((d) => d.id === q.get('d'))) state.desk = q.get('d')!;
  if (q.get('p') === '0') state.props = false;
  if (q.get('c') === '0') state.labels = false;
  if (q.get('mo') === '0') state.motion = false;
  state.pen = q.get('hw') === '1';
  if (PEN_FONTS.some((f) => f.id === q.get('pf'))) state.penFont = q.get('pf')!;
  // debug: force one peel behaviour on every card, e.g. #fx=taped
  const fx = q.get('fx');
  if (fx && ['free', 'adhesive', 'taped', 'pinned', 'magnetic', 'hung'].includes(fx)) peel.force = fx as typeof peel.force;
  if (q.get('dbg') === '1') timeline.toggle(true);
  const k = q.get('k')?.split(',').filter((id) => KINDS.some((x) => x.id === id));
  if (k?.length) state.kinds = k;
}

function writeHash() {
  const q = new URLSearchParams({
    s: `${state.seed}`,
    n: `${state.count}`,
    l: state.layout,
    m: state.mood,
    d: state.desk,
    g: `${state.grain}`,
    a: `${state.attach}`,
    L: `${state.light}`,
  });
  if (!state.props) q.set('p', '0');
  if (!state.labels) q.set('c', '0');
  if (!state.motion) q.set('mo', '0');
  if (state.pen) q.set('hw', '1');
  if (state.pen && state.penFont) q.set('pf', state.penFont);
  if (timeline.open) q.set('dbg', '1');
  if (state.kinds.length !== KINDS.length) q.set('k', state.kinds.join(','));
  history.replaceState(null, '', `#${q}`);
  publishState();
}

// ---------------------------------------------------------------- dom

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const desk = $<HTMLElement>('desk-area');
const bar = document.querySelector<HTMLElement>('.bar')!;

interface Item extends Body {
  /** Rotation in the scatter layout (grid straightens cards; `rot` is what is shown now). */
  restRot: number;
  card?: { plan: CardPlan; built: BuiltCard; kindId: string; seed: number; /** undefined until prepared, null when the card has none */ motion?: CardMotion | null };
  prop?: PropSpec;
}
let items: Item[] = [];
let zTop = 1;
let selected: Item | null = null;
let generation = 0;

function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout((toast as any).h);
  (toast as any).h = setTimeout(() => t.classList.remove('show'), 1400);
}

const deskDef = () => DESKS.find((d) => d.id === state.desk) ?? DESKS[0];

function caption(plan: CardPlan) {
  const p = PAPERS[plan.info.paper];
  const el = document.createElement('div');
  el.className = 'cap';
  const extras = [plan.info.fonts.join(' + '), plan.info.attachments.join(', ')].filter(Boolean).join(' · ');
  el.innerHTML = `${plan.info.kind}<br><i>${p?.preset ?? plan.info.paper}${p?.params ? '*' : ''}${extras ? ' · ' + extras : ''}</i>`;
  return el;
}

function makeCard(kindId: string, seed: number): Item {
  const kind = KINDS.find((k) => k.id === kindId)!;
  const plan = kind.make({ rng: makeRng(seed), mood: state.mood, mount: deskDef().mount, attachRate: state.attach, motion: state.motion ? MOTION_RATE : 0, pen: state.pen && state.penFont ? penFontAsFont(state.penFont) : undefined });
  const built = buildCard(plan);
  built.el.appendChild(caption(plan));
  return { el: built.el, x: 0, y: 0, w: plan.w, h: plan.h, rot: plan.rot, restRot: plan.rot, built, card: { plan, built, kindId, seed } };
}

let deskRevision = 0;
function applyDesk() {
  const revision = ++deskRevision;
  const d = deskDef();
  const key = d.id;
  document.body.style.setProperty('--desk', paperBase(key));
  desk.className = `desk ${d.cls ?? ''} ${state.layout === 'grid' ? 'grid' : ''} ${state.labels ? '' : 'no-caps'}`;
  desk.classList.toggle('light-desk', luminance(parseColor(paperBase(key))) > 0.5);
  deskTexture(key, d.zoom).then((t) => {
    if (revision !== deskRevision) return;
    document.body.style.backgroundImage = `url(${t.url})`;
    document.body.style.backgroundSize = `${t.size}px ${t.size}px`;
  });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Rotation a card is shown at (grid view straightens everything). */
const shownRot = (it: Item) => (state.layout === 'grid' ? 0 : it.rot);

/** Chance that a card kind with motion recipes animates. */
const MOTION_RATE = 0.65;

/** Render the card for its on-screen angle, then (once) build and start its content motion. */
async function renderCard(it: Item) {
  const c = it.card!;
  await c.built.render(shownRot(it));
  if (c.motion === undefined) {
    c.motion = prepareMotion(c.plan, c.built, makeRng(c.seed ^ 0x9e3779b9));
    c.motion?.play();
  }
}

async function renderQueue(list: Item[], gen: number) {
  for (const it of list) {
    if (gen !== generation) return;
    if (!it.card || it.card.built.litFor === shownRot(it)) continue;
    await nextFrame();
    if (gen !== generation) return;
    try {
      await renderCard(it);
    } catch (e) {
      console.error(e);
    }
  }
}

/** Replay every card's content motion, top to bottom, with the same stagger as the initial drop. */
function replayAll() {
  [...cards()].sort((a, b) => a.y - b.y).forEach((it, i) => it.card?.motion?.replay(Math.min(i * 25, 900)));
}

/** Debug: show every card's motion at progress 0..1. */
function seekAll(p: number) {
  for (const it of cards()) it.card?.motion?.seek(p);
}

function generate() {
  generation++;
  peel.reset();
  for (const it of items) it.card?.motion?.dispose();
  resetMotionBudget();
  desk.replaceChildren();
  items = [];
  select(null);
  LIGHT.azimuth = state.light;
  const rng = makeRng(state.seed * 7919 + 17);
  const kinds = KINDS.filter((k) => state.kinds.includes(k.id));
  if (kinds.length) {
    for (let i = 0; i < state.count; i++) {
      const kind = state.layout === 'grid' ? kinds[i % kinds.length] : rng.weighted(kinds, (k) => k.weight);
      items.push(makeCard(kind.id, Math.floor(rng() * 2 ** 31)));
    }
  }
  layout(true);
  for (const it of items) desk.appendChild(it.el);
  if (state.props) addProps(makeRng(state.seed * 131 + 7));
  writeHash();
  watchStats();
  void renderQueue([...items].sort((a, b) => a.y - b.y), generation);
}

// ---------------------------------------------------------------- props

const PENCILS = [['#f2c230', '#e3b98a'], ['#2d6a3e', '#e3b98a'], ['#1d1d22', '#d9b07a'], ['#c8372d', '#e3b98a'], ['#2a4fa8', '#e3b98a']];

function addProps(rng: Rng) {
  const W = desk.clientWidth;
  const H = desk.clientHeight;
  const mount = deskDef().mount;
  const want: PropSpec[] = [];
  const area = (W * H) / (1400 * 900);
  const n = (k: number) => Math.max(0, Math.round(k * area * rng.range(0.6, 1.3)));
  if (mount !== 'table') {
    for (let i = 0; i < n(6); i++) want.push({ kind: rng.pick(['pushpin', 'pushpin', 'mappin', 'thumbtack'] as PropKind[]), color: rng.pick(['#d23a3a', '#2f6fd6', '#f2c230', '#2fa36b', '#f0f0ee', '#e2672e']), angle: rng.range(0, 360) });
    if (mount === 'magnetic') for (let i = 0; i < n(4); i++) want.push({ kind: rng.pick(['magnet', 'magnet-neo', 'magnet-bar'] as PropKind[]), color: rng.pick(['#d23a3a', '#2f6fd6', '#f2c230', '#2fa36b']), angle: rng.range(-20, 20) });
  } else {
    for (let i = 0; i < Math.max(1, n(2)); i++) {
      const [c, wood] = rng.pick(PENCILS);
      want.push({ kind: 'pencil', color: c, color2: wood, angle: rng.range(0, 360), length: rng.range(120, 180) });
    }
    if (rng.chance(0.8)) want.push({ kind: 'ruler', angle: rng.range(-25, 25) + (rng.chance(0.3) ? 90 : 0), length: rng.pick([300, 220]) });
    if (rng.chance(0.8)) want.push({ kind: 'eraser', color: rng.pick(['#2a5cc8', '#d03a3a', '#2d8a4a']), angle: rng.range(0, 360) });
    if (rng.chance(0.7)) want.push({ kind: 'tape-roll', color: '#e6d9b8' });
    for (let i = 0; i < n(1.5); i++) want.push({ kind: 'washi-roll', color: rng.pick(['#e98b9a', '#8fc3e0', '#f2d27a', '#a9d3b0', '#c7b3e3']) });
    if (rng.chance(0.65)) want.push({ kind: 'mug', color: rng.pick(['#f1eee8', '#f1eee8', '#2d3e50', '#c94f3d', '#e8d9b0']), angle: rng.range(-60, 60) });
    if (rng.chance(0.5)) want.push({ kind: 'knife', color: rng.pick(['#e0662d', '#1d1d22', '#2a5cc8']), angle: rng.range(0, 360), length: 120 });
    for (let i = 0; i < n(2.5); i++) want.push({ kind: 'paperclip', color: rng.pick(['#cfd3d8', '#cfd3d8', '#d24a4a', '#3a6fd2', '#e9c03a']), angle: rng.range(0, 360) });
    for (let i = 0; i < n(1); i++) want.push({ kind: 'binder', color: rng.pick(['#1d1d22', '#c23b3b']), angle: rng.range(0, 360) });
    for (let i = 0; i < n(1.2); i++) want.push({ kind: 'pushpin', color: rng.pick(['#d23a3a', '#2f6fd6', '#f2c230']), angle: rng.range(0, 360) });
  }
  const top = bar.getBoundingClientRect().bottom + 20;
  // big objects prefer bare desk; pencils and clips are happy to lie on the papers
  const avoid: Partial<Record<PropKind, number>> = { mug: 1.2, 'tape-roll': 1, 'washi-roll': 0.9, eraser: 0.6, ruler: 0.25, pencil: 0.2, knife: 0.3 };
  const boxes: [number, number, number, number, number][] = cards().map((c) => [c.x, c.y, c.w, c.h, 1]);
  for (const spec of want) {
    const p = buildProp(spec);
    const fw = p.w * 0.6, fh = p.h * 0.6;
    let best: [number, number] = [0, 0], bestScore = Infinity;
    for (let t = 0; t < 24; t++) {
      const x = rng.range(20, W - 20), y = rng.range(top, Math.max(top + 1, H - 20));
      let score = rng() * 0.05;
      for (const [bx, by, bw, bh, wt] of boxes) {
        const ox = Math.min(x + fw / 2, bx + bw) - Math.max(x - fw / 2, bx);
        const oy = Math.min(y + fh / 2, by + bh) - Math.max(y - fh / 2, by);
        if (ox > 0 && oy > 0) score += ((ox * oy) / (fw * fh)) * wt * (avoid[spec.kind] ?? 0.4);
      }
      if (score < bestScore) (bestScore = score), (best = [x, y]);
    }
    const [x, y] = best;
    boxes.push([x - fw / 2, y - fh / 2, fw, fh, 2]);
    const it: Item = { el: p.el, x: x - p.ox, y: y - p.oy, w: p.w, h: p.h, rot: 0, restRot: 0, prop: spec, propBuilt: p, propKind: spec.kind };
    peel.setRest(it, it.x, it.y, 0);
    it.el.style.zIndex = `${spec.kind === 'mug' ? 90000 : ++zTop + 4000}`;
    desk.appendChild(it.el);
    items.push(it);
  }
}

// ---------------------------------------------------------------- layout

const cards = () => items.filter((i) => i.card);

function layout(initial = false) {
  peel.settleAll();
  const W = desk.clientWidth;
  const top = bar.getBoundingClientRect().bottom + 24;
  desk.classList.toggle('grid', state.layout === 'grid');
  if (state.layout === 'grid') gridLayout(W, top);
  else scatterLayout(W, top);
  cards().forEach((it, i) => {
    if (initial) it.el.style.animationDelay = `${Math.min(i * 25, 900)}ms`;
    peel.setRest(it, it.x, it.y, state.layout === 'grid' ? 0 : it.restRot);
  });
}

function scatterLayout(W: number, top: number) {
  const rng = makeRng(state.seed * 31 + 5);
  const list = cards();
  const area = list.reduce((a, p) => a + p.w * p.h, 0);
  const H = Math.max(innerHeight - top - 30, area / (W * 0.95));
  desk.style.height = `${top + H + 40}px`;
  // big sheets first so small notes land on top, with some shuffle
  const order = [...list].sort((a, b) => b.w * b.h * (0.6 + rng()) - a.w * a.h * (0.6 + rng()));
  const boxes: [number, number, number, number][] = [];
  for (const p of order) {
    const { w, h } = p;
    let best = [0, 0], bestScore = Infinity;
    for (let t = 0; t < 30; t++) {
      const x = rng.range(-w * 0.12, W - w * 0.88);
      const y = rng.range(top, top + Math.max(1, H - h * 0.85));
      let overlap = 0;
      for (const [bx, by, bw, bh] of boxes) {
        const ox = Math.min(x + w, bx + bw) - Math.max(x, bx);
        const oy = Math.min(y + h, by + bh) - Math.max(y, by);
        if (ox > 0 && oy > 0) overlap += ox * oy;
      }
      const score = overlap / (w * h) + rng() * 0.08;
      if (score < bestScore) (bestScore = score), (best = [x, y]);
    }
    p.x = best[0];
    p.y = best[1];
    boxes.push([p.x, p.y, w, h]);
    p.el.style.zIndex = `${++zTop}`;
  }
}

function gridLayout(W: number, top: number) {
  const gapX = 52, gapY = 84, pad = 28;
  const maxW = W - pad * 2;
  let y = top + 20;
  let row: Item[] = [];
  const flush = () => {
    if (!row.length) return;
    const rowW = row.reduce((a, p) => a + p.w, 0) + gapX * (row.length - 1);
    const rowH = Math.max(...row.map((p) => p.h));
    let x = pad + (maxW - rowW) / 2;
    for (const p of row) {
      p.x = x;
      p.y = y + (rowH - p.h) / 2;
      x += p.w + gapX;
    }
    y += rowH + gapY;
    row = [];
  };
  let used = 0;
  const rank = (p: Item) => KINDS.findIndex((k) => k.id === p.card!.kindId);
  for (const p of [...cards()].sort((a, b) => rank(a) - rank(b))) {
    if (row.length && used + gapX + p.w > maxW) {
      flush();
      used = 0;
    }
    used += (row.length ? gapX : 0) + p.w;
    row.push(p);
  }
  flush();
  desk.style.height = `${y + 20}px`;
}

// ---------------------------------------------------------------- interaction

function select(it: Item | null) {
  selected?.el.classList.remove('selected');
  selected = it;
  const box = $('inspect');
  if (!it?.card) {
    box.hidden = true;
    return;
  }
  it.el.classList.add('selected');
  const { plan } = it.card;
  const spec = PAPERS[plan.info.paper];
  $('iKind').textContent = plan.info.kind;
  $('iPaper').textContent = `${plan.info.paper}${spec && spec.preset !== plan.info.paper ? ` (${spec.preset} + overrides)` : ''}`;
  $('iFonts').textContent = plan.info.fonts.join(', ') || '—';
  $('iAttach').textContent = plan.info.attachments.join(', ') || '—';
  box.hidden = false;
}

function reroll(it: Item) {
  if (!it.card) return;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const next = makeCard(it.card.kindId, seed);
  next.el.style.zIndex = it.el.style.zIndex;
  next.el.style.animationDelay = '0ms';
  // keep the new card centred on the old one (read the old pose before it is overwritten)
  const x = it.x + (it.w - next.w) / 2, y = it.y + (it.h - next.h) / 2;
  it.card.motion?.dispose();
  it.el.replaceWith(next.el);
  Object.assign(it, next);
  peel.setRest(it, x, y, state.layout === 'grid' ? 0 : next.restRot);
  void renderCard(it);
  if (selected === it) select(it);
  watchStats();
}

const itemOf = (t: EventTarget | null) => {
  const el = (t as HTMLElement | null)?.closest<HTMLElement>('.card, .prop');
  return el ? items.find((q) => q.el === el) ?? null : null;
};

const PIN_KINDS = new Set(['pushpin', 'mappin', 'thumbtack']);

/** Every pin on the desk: loose pin props and the pins holding cards. */
function pinsOnDesk() {
  const out: PinRef[] = [];
  for (const it of items) {
    if (it.prop && it.propBuilt && PIN_KINDS.has(it.prop.kind)) {
      const sprite = it.el.querySelector<HTMLElement>('canvas.prop-sprite');
      const p = it.propBuilt;
      if (sprite) out.push({ owner: it, el: sprite, holder: it.el, pos: () => [it.x + p.ox, it.y + p.oy] });
    } else if (it.built?.holder.kind === 'pinned') {
      for (const pt of it.built.holder.points) {
        if (!pt.el) continue;
        out.push({
          owner: it,
          el: pt.el,
          pos: () => {
            const a = (it.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
            return [it.x + c * pt.x - s * pt.y, it.y + s * pt.x + c * pt.y];
          },
        });
      }
    }
  }
  return out;
}

const peel = createPeel(desk, {
  surface: () => ({ mount: deskDef().mount, friction: deskDef().friction }),
  pins: pinsOnDesk,
  bodyOf: itemOf,
  onGrab: (b) => {
    const it = b as Item;
    // the pickup curl snapshots the card's canvases right away: finish any half-drawn strokes first
    it.card?.motion?.finish();
    it.el.style.zIndex = `${it.prop?.kind === 'mug' ? 90001 : ++zTop + (it.prop ? 4000 : 0)}`;
  },
  onTap: (b) => select(b as Item | null),
  onRest: (b) => {
    // a spun or dropped card keeps its new angle when the layout is rebuilt
    if (state.layout !== 'grid') (b as Item).restRot = b.rot;
  },
  onSample: (b, s, kind) => timeline.record(b, s, kind),
});

/** Debug timeline (T): records and replays every interaction, runs canned gestures. */
const timeline = createTimeline({
  peel,
  desk,
  selected: () => selected,
  describe: (b) => {
    const it = b as Item;
    if (it.card) return `${it.card.plan.info.kind} (${it.card.plan.info.paper}, ${it.built!.thickness})`;
    return it.prop?.kind ?? 'prop';
  },
  motion: { seek: seekAll, replay: replayAll },
});

desk.addEventListener('dblclick', (e) => {
  const it = itemOf(e.target);
  if (it?.card) reroll(it);
});

// ---------------------------------------------------------------- controls

function seg(id: string, get: () => string, set: (v: string) => void) {
  const root = $(id);
  const sync = () => root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === get()));
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b?.dataset.v || b.dataset.v === get()) return;
    set(b.dataset.v);
    sync();
  });
  sync();
  return sync;
}

function slider(id: string, value: number, fmt: (v: number) => string, commit: (v: number) => void) {
  const input = $<HTMLInputElement>(id);
  const out = $<HTMLOutputElement>(`${id}Out`);
  input.value = `${value}`;
  out.textContent = fmt(value);
  input.oninput = () => (out.textContent = fmt(+input.value));
  input.onchange = () => commit(+input.value);
}

function initControls() {
  const setLayout = (v: Layout) => {
    state.layout = v;
    layout();
    writeHash();
    // shadows are baked per rotation: relight cards whose angle changed
    void renderQueue([...cards()].sort((a, b) => a.y - b.y), ++generation);
  };
  const syncLayout = seg('layout', () => state.layout, (v) => setLayout(v as Layout));
  seg('mood', () => state.mood, (v) => {
    state.mood = v as Mood;
    generate();
  });

  const deskSel = $<HTMLSelectElement>('desk');
  deskSel.innerHTML = DESKS.map((d) => `<option value="${d.id}">${d.label}</option>`).join('');
  deskSel.value = state.desk;
  deskSel.onchange = () => {
    state.desk = deskSel.value;
    applyDesk();
    // attachments and props depend on the surface (pins on boards, magnets on steel, tape on tables)
    generate();
  };

  slider('count', state.count, (v) => `${v}`, (v) => {
    state.count = v;
    generate();
  });
  slider('grain', state.grain, (v) => `${v.toFixed(2)}×`, (v) => {
    state.grain = v;
    setTextureScale(v);
    applyDesk();
    generate();
  });
  slider('attach', state.attach, (v) => `${Math.round(v * 100)}%`, (v) => {
    state.attach = v;
    generate();
  });
  slider('light', state.light, (v) => `${Math.round(v)}°`, (v) => {
    state.light = v;
    generate();
  });
  const propsBox = $<HTMLInputElement>('props');
  propsBox.checked = state.props;
  propsBox.onchange = () => {
    state.props = propsBox.checked;
    generate();
  };
  const labelsBox = $<HTMLInputElement>('labels');
  const syncLabels = () => desk.classList.toggle('no-caps', !state.labels);
  labelsBox.checked = state.labels;
  labelsBox.onchange = () => {
    state.labels = labelsBox.checked;
    syncLabels();
    writeHash();
  };
  syncLabels();
  const motionBox = $<HTMLInputElement>('motion');
  motionBox.checked = state.motion;
  motionBox.onchange = () => {
    state.motion = motionBox.checked;
    generate();
  };
  $('replay').onclick = replayAll;

  const penBox = $<HTMLInputElement>('pen');
  const penSel = $<HTMLSelectElement>('penFont');
  penSel.innerHTML =
    `<option value="">Match fonts</option>` +
    (['outline', 'single'] as const)
      .map((k) => `<optgroup label="${k === 'single' ? 'Single-line' : 'Outline'}">${PEN_FONTS.filter((f) => f.kind === k).map((f) => `<option value="${f.id}">${f.label}</option>`).join('')}</optgroup>`)
      .join('');
  const syncPen = () => {
    penBox.checked = state.pen;
    penSel.value = state.penFont;
    $('penFontCtl').hidden = !state.pen;
  };
  const onPen = async () => {
    state.pen = penBox.checked;
    state.penFont = penSel.value;
    syncPen();
    await applyPen();
    generate();
  };
  penBox.onchange = penSel.onchange = onPen;
  syncPen();

  const menu = $('kinds');
  const renderKinds = () => {
    menu.innerHTML =
      KINDS.map((k) => `<label><input type="checkbox" value="${k.id}" ${state.kinds.includes(k.id) ? 'checked' : ''}/> ${k.label}</label>`).join('') +
      `<div class="row"><button data-all="1">All</button><button data-all="0">None</button></div>`;
  };
  renderKinds();
  $('kindsBtn').onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => (menu.hidden = true));
  menu.addEventListener('change', () => {
    state.kinds = [...menu.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
    generate();
  });
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-all]');
    if (!b) return;
    state.kinds = b.dataset.all === '1' ? KINDS.map((k) => k.id) : [KINDS[0].id];
    renderKinds();
    generate();
  });

  const shuffle = () => {
    state.seed = Math.floor(Math.random() * 99999);
    generate();
  };
  $('shuffle').onclick = shuffle;
  addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'r' || e.key === 'R') shuffle();
    if (e.key === 'm' || e.key === 'M') replayAll();
    if (e.key === 'g' || e.key === 'G') {
      setLayout(state.layout === 'grid' ? 'scatter' : 'grid');
      syncLayout();
    }
    if (e.key === 'Escape') select(null);
  });

  $('iReroll').onclick = () => selected && reroll(selected);
  $('iCopy').onclick = async () => {
    if (!selected?.card) return;
    const { plan } = selected.card;
    const spec = PAPERS[plan.info.paper];
    const params = { ...(spec.params ?? {}), ...(plan.params ?? {}) };
    const code =
      `import { PaperRenderer, buildParams } from 'procedural-paper';\n\n` +
      `const renderer = new PaperRenderer();\n` +
      `const params = buildParams('${spec.preset}', ${JSON.stringify(params, null, 2)});\n` +
      `const sheet = renderer.renderSheet(params, ${JSON.stringify({ width: plan.w, height: plan.h, pixelRatio: 2, ...plan.look }, null, 2)}, ['color']);\n` +
      `// sheet.maps.color: RGBA pixels with alpha + shadow (see toCanvas)\n`;
    await navigator.clipboard.writeText(code);
    toast('Sheet code copied');
  };

  for (const flavor of ['Vanilla', 'React'] as const) {
    $('i' + flavor).onclick = async () => {
      if (!selected?.card) return;
      const { built, seed } = selected.card;
      try {
        const { openExampleExporter } = await import('./example-exporter');
        openExampleExporter(compositionFor(built, seed, shownRot(selected)), flavor);
      } catch (error) { toast(String(error)); }
    };
  }

  let rt = 0;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = window.setTimeout(() => layout(), 150);
  });
}

let statTimer = 0;
function watchStats() {
  clearInterval(statTimer);
  const t0 = performance.now();
  const tick = () => {
    const ready = document.querySelectorAll('.card.ready').length;
    const total = cards().length;
    $('stat').textContent = `${rendererBackend()} · ${ready}/${total} sheets · ${stats.renders} tiles`;
    if (ready >= total && performance.now() - t0 > 1500) clearInterval(statTimer);
  };
  statTimer = window.setInterval(tick, 200);
  tick();
}

/** Load what the Pen setting needs (nothing when off): the matching outline fonts, or the one chosen pen font. */
async function applyPen() {
  setPen(state.pen);
  if (!state.pen) return;
  const t0 = performance.now();
  await enablePen(state.penFont ? [state.penFont] : PEN_FONTS.filter((f) => f.matches).map((f) => f.id));
  console.info(`[pen] ready in ${Math.round(performance.now() - t0)}ms`);
}

readHash();
LIGHT.azimuth = state.light;
setTextureScale(state.grain);
initControls();
applyDesk();
if (state.pen) void applyPen().then(generate);
else generate();

(window as any).desk = { state, generate, timeline, replayAll, seekAll, pen: { enablePen, PEN_FONTS }, get items() { return items; } };
