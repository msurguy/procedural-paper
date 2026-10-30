/**
 * How the content of a card animates: a list of steps on one timeline per
 * card. Makers attach a `MotionSpec` to their plan; motion.ts runs it after
 * the card is rendered. Targets are selectors scoped to the card's ink layer
 * (text fitting rewrites the ink's innerHTML, so element references taken in
 * a maker are stale by the time the card is on the desk).
 *
 * This module is types and tiny helpers only: cards.ts imports it without
 * pulling brushmark into the maker code path.
 */
import type { AnnotationConfig } from 'brushmark';
import type { Rng } from './rng';

/** A selector scoped to the card's ink layer, or an element inside it. */
export type Target = string | HTMLElement;
/** Timeline position: seconds, or relative to the previous step (`'>'`, `'>+0.2'`, `'>-0.1'`). */
export type At = number | string;

interface StepBase {
  target: Target;
  at?: At;
  /** Seconds. */
  duration?: number;
  /** Seconds, on top of `at`. */
  delay?: number;
  /** GSAP-style ease name: `power2.out`, `back.out`, `none`... */
  ease?: string;
  /** Brush steps over the per-card budget are dropped lowest priority first (default 0). */
  priority?: number;
}

/** A Brushmark annotation (underline, circle, highlight, box, bracket, contour...). */
export type BrushStep = StepBase & { kind: 'brush' } & Omit<AnnotationConfig, 'observe' | 'measure' | 'animate' | 'timelineVars' | 'repeat' | 'yoyo' | 'onResize'>;
/** Draw an SVG's paths on, stroke by stroke. */
export type DrawStep = StepBase & { kind: 'draw'; /** Seconds between paths (negative overlaps). */ stagger?: number };
/**
 * Reveal text: typewriter glyphs (`.typed` ink), or a clip sweep across / down a block.
 * With the optional Pen on (handwriting.ts), `auto` and `pen` draw handwriting stroke by stroke when the face has a pen font.
 */
export type WriteStep = StepBase & { kind: 'write'; mode?: 'auto' | 'glyph' | 'sweep-x' | 'sweep-y' | 'pen'; /** Glyphs per second. */ rate?: number };
export type FadeStep = StepBase & { kind: 'fade'; from?: number };
/** Fade in while settling down from `dy` px above. */
export type RiseStep = StepBase & { kind: 'rise'; dy?: number };
/** Slam down: scale overshoot from `from` with a fast fade-in (stamps, postmarks). */
export type StampStep = StepBase & { kind: 'stamp'; from?: number };

/** Instant film developing: an overlay that starts opaque and clears (the element is hidden at rest). */
export type DevelopStep = StepBase & { kind: 'develop' };

export type MotionStep = BrushStep | DrawStep | WriteStep | FadeStep | RiseStep | StampStep | DevelopStep;

export interface MotionSpec {
  steps: MotionStep[];
  /** Seconds before the first step (after the card has dropped onto the desk). */
  delay?: number;
  /** Default duration for steps that leave it out. */
  duration?: number;
  /** Gap in seconds between steps that leave `at` out (negative overlaps). */
  stagger?: number;
}

// ---------------------------------------------------------------- helpers for makers

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Wrap text in a span a step can target; use as a FitBlock's `html`. */
export const mark = (text: string, cls = 'm') => `<span class="${cls}">${esc(text)}</span>`;

/**
 * A spec when `on`, else nothing. Makers decide `on` from a forked rng
 * (`const m = rng.fork(); const mo = m.chance(ctx.motion)`) so the card's
 * content is the same whether motion is enabled or not.
 */
export function motion(on: boolean, steps: MotionStep[], opts: Omit<MotionSpec, 'steps'> = {}): MotionSpec | undefined {
  return on && steps.length ? { steps, ...opts } : undefined;
}

const seed = (rng: Rng) => rng.int(1, 1e9);

/**
 * A brush with an absolute stroke weight. Brushmark scales weight with the
 * target's font size (16px = 1x), but card text is small (10-28px after
 * fitting) and the ink is 1-2px wide, so scaled strokes come out hairline.
 * Annotation strokes should read as a pen pressed a little harder than the
 * writing: a fixed weight around 2.5-3.5 on the soft pencils, varied per card.
 */
const pen = (rng: Rng, weight: number, color?: string, names: readonly string[] = ['2B', '2B', 'HB', 'cpencil']) => ({
  name: rng.pick(names),
  color,
  weight: weight * rng.range(0.9, 1.15),
  scaleWithFont: false,
});

// recipes: all seeded from the rng they are given, so a card's strokes are the same for the same seed

export const underlineTitle = (rng: Rng, target: Target = '.t', color?: string): MotionStep[] => [
  // handwriting is set tight: pull the line up into the descender space so it does not cut the next line
  { kind: 'brush', type: 'underline', target, brush: pen(rng, 3, color), padding: [-3, 2], duration: 0.5, seed: seed(rng) },
];

export const strikeDone = (rng: Rng, target: Target = '.done', color?: string): MotionStep[] => [
  { kind: 'brush', type: 'strike-through', target, brush: pen(rng, 2.6, color), duration: 0.3, at: '>-0.1', seed: seed(rng) },
];

export const circleWord = (rng: Rng, target: Target, color?: string): MotionStep[] => [
  { kind: 'brush', type: 'circle', target, brush: pen(rng, 3.2, color, ['2B', '2B', 'marker']), padding: 3, duration: 0.6, seed: seed(rng) },
];

export const highlightLine = (rng: Rng, target: Target, color = '#4dabf7', opacity = 150): MotionStep[] => [
  {
    kind: 'brush',
    type: 'highlight',
    target,
    highlightStyle: 'watercolor',
    brush: { fill: { color, opacity, bleed: 0.2, texture: 0.5 } },
    duration: 1.4,
    seed: seed(rng),
  },
];

export const boxWord = (rng: Rng, target: Target, color?: string): MotionStep[] => [
  { kind: 'brush', type: 'box', target, brush: pen(rng, 2.6, color), padding: 3, duration: 0.5, seed: seed(rng) },
];

export const bracketQuote = (rng: Rng, target: Target, color?: string): MotionStep[] =>
  rng.chance(0.5)
    ? [{ kind: 'brush', type: 'bracket', brackets: ['left', 'right'], target, brush: pen(rng, 3.4, color), padding: 6, duration: 0.7, seed: seed(rng) }]
    : [{ kind: 'brush', type: 'contour', target, brush: pen(rng, 2.8, color), padding: 8, duration: 0.9, seed: seed(rng) }];

export const drawDoodle = (target: Target = '.doodle svg', duration = 1.2): MotionStep[] => [{ kind: 'draw', target, duration, ease: 'power1.inOut' }];

export const typeIn = (target: Target = '.ink.typed', rate = 28): MotionStep[] => [{ kind: 'write', target, mode: 'glyph', rate }];

export const writeOn = (target: Target, duration = 1.2): MotionStep[] => [{ kind: 'write', target, mode: 'auto', duration }];

export const stampIn = (target: Target): MotionStep[] => [{ kind: 'stamp', target, duration: 0.35, ease: 'back.out' }];

export const riseIn = (target: Target, dy = 6, at?: At): MotionStep[] => [{ kind: 'rise', target, dy, duration: 0.4, at }];

export const fadeIn = (target: Target, duration = 0.3, at?: At): MotionStep[] => [{ kind: 'fade', target, duration, at }];

export const developPhoto = (target: Target = '.develop', duration = 2.6): MotionStep[] => [{ kind: 'develop', target, duration, ease: 'power1.in' }];

/** A grease-pencil mark around a picked frame (contact sheets, film strips). */
export const markFrame = (rng: Rng, target: Target, color: string): MotionStep[] => [
  rng.chance(0.6)
    ? { kind: 'brush', type: 'circle', target, brush: pen(rng, 4.2, color, ['marker', 'cpencil']), padding: 4, duration: 0.7, seed: seed(rng) }
    : { kind: 'brush', type: 'box', target, brush: pen(rng, 4, color, ['marker', 'cpencil']), padding: 3, duration: 0.6, seed: seed(rng) },
];
