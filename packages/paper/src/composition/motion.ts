/**
 * Runs a card's MotionSpec: one paused Brushmark timeline per card, with
 * annotation timelines nested as children and native steps (draw, write,
 * fade, rise, stamp) as tweens on plain numbers.
 *
 * Performance rules:
 *  - layout is read only in `prepare`, inside withUnrotated, once per card;
 *  - tweens write numbers; the master timeline's onUpdate flushes one batched
 *    style write per dirty element (transform / opacity / clip-path, plus
 *    stroke-dashoffset for the one small doodle SVG);
 *  - every card ticks on Brushmark's single rAF ticker, which stops when
 *    nothing is playing; Brushmark repaints only dirty overlays;
 *  - annotations are built one card per frame by the render queue, and the
 *    brush budget caps GL paints per card and per desk.
 */
import { annotate, builtinEngine, flushReveals, type BrushAnnotation, type BrushTimeline } from 'brushmark';
import type { CardPlan } from './scene';
import type { BuiltCard } from './renderer';
import type { Rng } from './rng';
import type { At, BrushStep, DevelopStep, DrawStep, FadeStep, MotionSpec, MotionStep, RiseStep, StampStep, WriteStep } from './motion-spec';
import { inlineTransform, withUnrotated } from './unrotate';
import type { PenContext } from './pen';
import { penText } from './pen';

export interface CardMotion {
  timeline: BrushTimeline;
  /** Start after the card's drop animation (right away if it already ran). */
  play(): void;
  pause(): void;
  resume(): void;
  /** Restart from the beginning after `delayMs`. */
  replay(delayMs?: number): void;
  /** Pause and show the state at progress 0..1 (debug scrubber). */
  seek(p: number): void;
  /** Jump to the end state, painted right now (grab, reduced motion). */
  finish(): void;
  dispose(): void;
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- per-card state

interface Flushable {
  flush(): void;
}

/** Compositor-only state of one element; written in one go when dirty. */
class Pose implements Flushable {
  x = 0;
  y = 0;
  s = 1;
  o = 1;
  /** Percent hidden from the right / bottom (clip sweeps). */
  cx = 0;
  cy = 0;
  private readonly base: string;
  private readonly o0: number;
  private readonly saved: { transform: string; opacity: string; clipPath: string };
  constructor(readonly el: HTMLElement) {
    // poses are made inside withUnrotated, where inline transforms are flattened: read the real one
    this.base = inlineTransform(el);
    this.saved = { transform: this.base, opacity: el.style.opacity, clipPath: el.style.clipPath };
    this.o0 = parseFloat(getComputedStyle(el).opacity) || 1;
    el.dataset.mv = '';
  }
  flush() {
    const st = this.el.style;
    const moved = this.x || this.y || this.s !== 1;
    st.transform = moved ? `${this.base} translate(${this.x.toFixed(2)}px, ${this.y.toFixed(2)}px) scale(${this.s.toFixed(4)})`.trim() : this.base;
    st.opacity = this.o >= 1 ? this.saved.opacity : `${(this.o0 * this.o).toFixed(3)}`;
    st.clipPath = this.cx > 0 ? `inset(0 ${this.cx.toFixed(2)}% 0 0)` : this.cy > 0 ? `inset(0 0 ${this.cy.toFixed(2)}% 0)` : this.saved.clipPath;
  }
  restore() {
    Object.assign(this.el.style, this.saved);
    delete this.el.dataset.mv;
  }
}

interface StepCtx {
  pen?: PenContext;
  card: HTMLElement;
  ink: HTMLElement;
  rng: Rng;
  /** Spec-level default duration. */
  duration: number;
  pose(el: HTMLElement): Pose;
  /** Flush `f` on the next master update. */
  mark(f: Flushable): void;
  /** A paused child timeline, to be added to the master at the step's position. */
  child(): BrushTimeline;
}

interface Prepared {
  /** Fill the child timeline (tweens start at 0 within it). */
  build(tl: BrushTimeline): void;
  dispose(): void;
}

interface StepImpl<S extends MotionStep> {
  /** May read layout (runs inside withUnrotated). Null when there is nothing to do. */
  prepare(targets: HTMLElement[], step: S, ctx: StepCtx): Prepared | null;
}

const dur = (step: MotionStep, ctx: StepCtx, fallback: number) => step.duration ?? (ctx.duration || fallback);

// ---------------------------------------------------------------- steps

const brush: StepImpl<BrushStep> = {
  prepare(targets, step, ctx) {
    const { kind: _k, target: _t, at: _a, priority: _p, ...cfg } = step;
    const annos: BrushAnnotation[] = targets.map((el) =>
      annotate(el, {
        ...cfg,
        duration: step.duration ?? (ctx.duration || cfg.duration),
        observe: false,
        measure: (run) => withUnrotated(ctx.card, run, [el]),
        seed: cfg.seed ?? ctx.rng.int(1, 1e9),
      }),
    );
    for (const a of annos) a.prepare();
    return {
      build(tl) {
        annos.forEach((a, i) => tl.add(a.timeline, i === 0 ? 0 : '>-0.1'));
      },
      dispose: () => annos.forEach((a) => a.remove()),
    };
  },
};

const draw: StepImpl<DrawStep> = {
  prepare(targets, step, ctx) {
    const paths = targets.flatMap((t) => (t instanceof SVGPathElement ? [t] : [...t.querySelectorAll('path')]));
    if (!paths.length) return null;
    const items = paths.map((p) => {
      const len = p.getTotalLength();
      const saved = { dasharray: p.style.strokeDasharray, dashoffset: p.style.strokeDashoffset, opacity: p.style.opacity };
      p.style.strokeDasharray = `${len}`;
      const it = {
        t: 0,
        flush() {
          p.style.strokeDashoffset = `${(len * (1 - it.t)).toFixed(2)}`;
          // a zero-length dash still shows a round-cap dot: hide until the stroke starts
          p.style.opacity = it.t > 0 ? saved.opacity : '0';
        },
        restore: () => Object.assign(p.style, { strokeDasharray: saved.dasharray, strokeDashoffset: saved.dashoffset, opacity: saved.opacity }),
      };
      it.flush();
      return it;
    });
    const total = dur(step, ctx, 1.2);
    const stagger = step.stagger ?? 0;
    // each path gets time in proportion to its length, laid end to end
    const lens = paths.map((p) => p.getTotalLength());
    const sum = lens.reduce((a, b) => a + b, 0) || 1;
    return {
      build(tl) {
        let pos = 0;
        items.forEach((it, i) => {
          const d = Math.max(0.05, (total * lens[i]) / sum);
          tl.to(it, { t: 1, duration: d, ease: step.ease ?? 'power1.inOut', onUpdate: () => ctx.mark(it) }, pos);
          pos += d + stagger;
        });
      },
      dispose: () => items.forEach((it) => it.restore()),
    };
  },
};

/** Text-bearing elements under `el`, in reading order: elements whose children are only text, <br> or inline phrasing. */
const INLINE = new Set(['SPAN', 'B', 'I', 'EM', 'STRONG', 'S', 'U', 'SMALL', 'SUB', 'SUP', 'BR']);
function textLeaves(el: HTMLElement): HTMLElement[] {
  const kids = [...el.children] as HTMLElement[];
  if (kids.every((k) => INLINE.has(k.tagName) && !k.querySelector(':not(span,b,i,em,strong,s,u,small,sub,sup,br)'))) return el.textContent?.trim() ? [el] : [];
  return kids.flatMap(textLeaves);
}

/** Seconds of pen time per second on the desk, and the longest a block may take: real stroke timing is slow for long text. */
const PEN_SPEED = 1.6;
const PEN_MAX = 8;

/** Tegaki pen strokes (handwriting.ts), one engine per text block, written one after another. Null when any block has no pen font. */
function penWrite(el: HTMLElement, step: WriteStep, ctx: StepCtx): Prepared | null {
  const Engine = ctx.pen?.Engine;
  const leaves = textLeaves(el);
  const fonts = leaves.map((l) => ctx.pen?.bundleFor(getComputedStyle(l).fontFamily));
  if (!Engine || !leaves.length || fonts.some((f) => !f)) return null;
  const blocks = leaves.map((leaf, i) => {
    const text = penText(leaf.innerText.trim(), fonts[i]!);
    const html = leaf.innerHTML;
    // the engine keeps the text as transparent DOM in the same flow, so the block keeps its size and its text stays selectable
    leaf.textContent = '';
    const host = document.createElement('span');
    host.className = 'pen';
    leaf.appendChild(host);
    const engine = new Engine(host, { font: fonts[i]!, text, time: { mode: 'controlled', value: 0 }, seed: ctx.rng.int(0, 1e6) });
    return { leaf, html, engine, len: engine.duration || text.length * 0.12, t: -1 };
  });
  const natural = blocks.reduce((a, b) => a + b.len, 0);
  const d = Math.min(PEN_MAX, Math.max(natural / PEN_SPEED, step.duration ?? 0));
  const k = natural / d;
  const st = {
    t: 0,
    flush() {
      let at = st.t * k;
      for (const b of blocks) {
        const t = Math.min(b.len, Math.max(0, at));
        if (t !== b.t) b.engine.update({ time: { mode: 'controlled', value: (b.t = t) } });
        at -= b.len;
      }
    },
  };
  st.flush();
  return {
    build: (tl) => tl.to(st, { t: d, duration: d, ease: 'none', onUpdate: () => ctx.mark(st) }, 0),
    dispose: () =>
      blocks.forEach((b) => {
        b.engine.destroy();
        b.leaf.innerHTML = b.html;
      }),
  };
}

const write: StepImpl<WriteStep> = {
  prepare(targets, step, ctx) {
    const prepared: Prepared[] = [];
    for (const el of targets) {
      const glyphs = [...el.querySelectorAll<HTMLElement>('.w > span')];
      let mode = step.mode ?? 'auto';
      if ((mode === 'auto' || mode === 'pen') && !glyphs.length && ctx.pen) {
        const p = penWrite(el, step, ctx);
        if (p) {
          prepared.push(p);
          continue;
        }
      }
      if (mode === 'pen') mode = 'auto';
      if (mode === 'auto') mode = glyphs.length ? 'glyph' : el.offsetHeight > 1.6 * parseFloat(getComputedStyle(el).fontSize) ? 'sweep-y' : 'sweep-x';
      if (mode === 'glyph') {
        if (!glyphs.length) continue;
        // typed() already gave every glyph its own ink density: hide them all, then reveal in order
        const saved = glyphs.map((g) => g.style.opacity);
        for (const g of glyphs) g.style.opacity = '0';
        let applied = 0;
        const st = {
          n: 0,
          flush() {
            const want = Math.min(glyphs.length, Math.max(0, Math.floor(st.n)));
            for (let i = applied; i < want; i++) glyphs[i].style.opacity = saved[i];
            for (let i = want; i < applied; i++) glyphs[i].style.opacity = '0';
            applied = want;
          },
        };
        const rate = step.rate ?? 28;
        const d = step.duration ?? glyphs.length / rate;
        prepared.push({
          build: (tl) => tl.to(st, { n: glyphs.length, duration: d, ease: 'none', onUpdate: () => ctx.mark(st) }, 0),
          dispose: () => glyphs.forEach((g, i) => (g.style.opacity = saved[i])),
        });
      } else {
        const pose = ctx.pose(el);
        const key = mode === 'sweep-x' ? 'cx' : 'cy';
        pose[key] = 100;
        pose.flush();
        prepared.push({
          build: (tl) => tl.to(pose, { [key]: 0, duration: dur(step, ctx, 1), ease: step.ease ?? 'none', onUpdate: () => ctx.mark(pose) }, 0),
          dispose: () => pose.restore(),
        });
      }
    }
    if (!prepared.length) return null;
    return { build: (tl) => prepared.forEach((p) => p.build(tl)), dispose: () => prepared.forEach((p) => p.dispose()) };
  },
};

/** Pose tweens shared by fade / rise / stamp: set the start pose, tween to rest. */
function poseStep<S extends FadeStep | RiseStep | StampStep>(start: (p: Pose, s: S) => void, tween: (tl: BrushTimeline, p: Pose, s: S, d: number, mark: () => void) => void): StepImpl<S> {
  return {
    prepare(targets, step, ctx) {
      const poses = targets.map((el) => {
        const p = ctx.pose(el);
        start(p, step);
        p.flush();
        return p;
      });
      return {
        build: (tl) => poses.forEach((p) => tween(tl, p, step, dur(step, ctx, 0.4), () => ctx.mark(p))),
        dispose: () => poses.forEach((p) => p.restore()),
      };
    },
  };
}

const fade = poseStep<FadeStep>(
  (p, s) => (p.o = s.from ?? 0),
  (tl, p, s, d, mark) => tl.to(p, { o: 1, duration: d, ease: s.ease ?? 'power1.out', onUpdate: mark }, 0),
);

const rise = poseStep<RiseStep>(
  (p, s) => ((p.o = 0), (p.y = s.dy ?? 6)),
  (tl, p, s, d, mark) => tl.to(p, { o: 1, y: 0, duration: d, ease: s.ease ?? 'power2.out', onUpdate: mark }, 0),
);

const stamp = poseStep<StampStep>(
  (p, s) => ((p.o = 0), (p.s = s.from ?? 1.6)),
  (tl, p, s, d, mark) => {
    tl.to(p, { s: 1, duration: d, ease: s.ease ?? 'back.out', onUpdate: mark }, 0);
    tl.to(p, { o: 1, duration: d * 0.4, ease: 'power2.out', onUpdate: mark }, 0);
  },
);

/** Opacity 1 -> 0 on an element that is invisible at rest (opacity: 0 in CSS), so motion-off shows the clear photo. */
const develop: StepImpl<DevelopStep> = {
  prepare(targets, step, ctx) {
    const states = targets.map((el) => {
      const st = { v: 1, flush: () => void (el.style.opacity = st.v.toFixed(3)) };
      st.flush();
      return st;
    });
    return {
      build: (tl) => states.forEach((st) => tl.to(st, { v: 0, duration: dur(step, ctx, 2.6), ease: step.ease ?? 'power1.in', onUpdate: () => ctx.mark(st) }, 0)),
      dispose: () => targets.forEach((el) => (el.style.opacity = '')),
    };
  },
};

const STEP_KINDS: { [K in MotionStep['kind']]: StepImpl<Extract<MotionStep, { kind: K }>> } = { brush, draw, write, fade, rise, stamp, develop };

// ---------------------------------------------------------------- orchestration

/** Fold a step's own delay into its timeline position (`>`, `>+n`, `>-n`, `+=n`, `-=n` or seconds). */
function withDelay(at: At, delay: number): At {
  if (!delay) return at;
  if (typeof at === 'number') return at + delay;
  const rel = /^>([+-]?\d*\.?\d+)?$/.exec(at);
  if (rel) return `>${(parseFloat(rel[1] ?? '0') + delay).toFixed(3)}`;
  const off = /^([+-])=(\d*\.?\d+)$/.exec(at);
  if (off) {
    const n = (off[1] === '-' ? -1 : 1) * parseFloat(off[2]) + delay;
    return `${n < 0 ? '-' : '+'}=${Math.abs(n).toFixed(3)}`;
  }
  return at;
}

function resolveTargets(ink: HTMLElement, step: MotionStep): HTMLElement[] {
  if (typeof step.target === 'string') return [...ink.querySelectorAll<HTMLElement>(step.target)];
  return ink.contains(step.target) ? [step.target] : [];
}

export function prepareMotion(plan: CardPlan, built: BuiltCard, rng: Rng, pen?: PenContext): CardMotion | null {
  const spec: MotionSpec | undefined = plan.motion;
  const ink = plan.ink;
  if (!spec?.steps.length || !ink) return null;

  const dirty = new Set<Flushable>();
  const poses = new Map<HTMLElement, Pose>();
  const flushAll = () => {
    for (const f of dirty) f.flush();
    dirty.clear();
  };
  const card = built.el;
  const master = builtinEngine.createTimeline({ paused: true, onUpdate: flushAll, onComplete: () => card.classList.remove('motion') });
  const ctx: StepCtx = {
    card,
    pen,
    ink,
    rng,
    duration: spec.duration ?? 0,
    pose: (el) => poses.get(el) ?? (poses.set(el, new Pose(el)), poses.get(el)!),
    mark: (f) => dirty.add(f),
    child: () => builtinEngine.createTimeline({ paused: true }),
  };

  const steps = spec.steps.map((step) => ({ step, targets: resolveTargets(ink, step) })).filter((x) => x.targets.length);
  if (!steps.length) return null;

  // one unrotated span per card: every step measures in the card's own frame
  const prepared = withUnrotated(
    card,
    () => steps.map(({ step, targets }) => ({ step, p: (STEP_KINDS[step.kind] as StepImpl<MotionStep>).prepare(targets, step, ctx) })),
    steps.flatMap((x) => x.targets),
  ).filter((x): x is { step: MotionStep; p: Prepared } => !!x.p);
  if (!prepared.length) return null;

  const gap = spec.stagger ?? 0;
  prepared.forEach(({ step, p }, i) => {
    const at: At = step.at ?? (i === 0 ? (spec.delay ?? 0) : gap === 0 ? '>' : `>${gap}`);
    const child = ctx.child();
    p.build(child);
    master.add(child, withDelay(at, step.delay ?? 0));
  });
  flushAll();

  let disposed = false;
  let timer = 0;
  const reduced = prefersReducedMotion();
  if (reduced) {
    master.progress(1);
    flushReveals();
  }

  const start = () => {
    if (disposed || reduced) return;
    card.classList.add('motion');
    master.play(0);
  };
  return {
    timeline: master,
    pause() { clearTimeout(timer); master.pause(); },
    resume() { if (!disposed && !reduced) { card.classList.add('motion'); master.play(); } },
    play() {
      if (disposed || reduced) return;
      const drop = card.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName === 'drop');
      if (drop) drop.finished.then(start, () => {});
      else start();
    },
    replay(delayMs = 0) {
      if (disposed || reduced) return;
      clearTimeout(timer);
      master.pause(0);
      timer = window.setTimeout(start, delayMs);
    },
    seek(p) {
      if (disposed) return;
      clearTimeout(timer);
      master.pause();
      master.progress(Math.min(1, Math.max(0, p)));
    },
    finish() {
      if (disposed) return;
      clearTimeout(timer);
      master.pause();
      master.progress(1);
      flushReveals();
      card.classList.remove('motion');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      master.kill();
      for (const { p } of prepared) p.dispose();
      card.classList.remove('motion');
    },
  };
}
