/**
 * Run a layout measurement with a card in its untransformed frame.
 *
 * Brushmark (and anything else using Range / getBoundingClientRect) measures
 * in viewport px, but every card is rotated with a CSS transform and some ink
 * elements carry their own inline rotate. Inside `fn` the card, and every
 * inline-transformed ancestor of the `within` elements up to the card, are
 * flattened, so measured rects are in the card's own frame.
 *
 * Nothing is painted: it all happens synchronously in one task. The card's
 * 0.7 s transform transition does not fire either: transforms are restored
 * while `transition` is still `none`, style is flushed, then transitions come
 * back (the same trick peel.ts uses when it bakes a rest pose).
 *
 * Re-entrant: nested calls on the same card just run `fn`.
 */
const depth = new WeakMap<HTMLElement, number>();
/** Inline transforms as they were before the current flattened span (so code running inside can still read them). */
const originals = new WeakMap<HTMLElement, string>();

/** The element's inline `transform` as it is outside any withUnrotated span. */
export const inlineTransform = (el: HTMLElement) => originals.get(el) ?? el.style.transform;

export function withUnrotated<T>(card: HTMLElement, fn: () => T, within: HTMLElement[] = []): T {
  if ((depth.get(card) ?? 0) > 0) return fn();
  depth.set(card, 1);

  // the card plus any inline-transformed element between the targets and the card
  const els = new Set<HTMLElement>([card]);
  for (const t of within) {
    for (let e: HTMLElement | null = t; e && e !== card; e = e.parentElement) {
      if (e.style.transform || e.style.rotate || e.style.scale) els.add(e);
    }
  }
  const saved = [...els].map((el) => ({ el, transition: el.style.transition, transform: el.style.transform, rotate: el.style.rotate, scale: el.style.scale }));
  for (const s of saved) {
    originals.set(s.el, s.transform);
    s.el.style.transition = 'none';
    s.el.style.transform = 'none';
    if (s.rotate) s.el.style.rotate = 'none';
    if (s.scale) s.el.style.scale = 'none';
  }
  // the `drop` keyframe scales the card for 0.45 s after it appears: an !important
  // declaration outranks the animation without restarting it
  card.style.setProperty('scale', '1', 'important');
  try {
    return fn();
  } finally {
    for (const s of saved) {
      s.el.style.transform = s.transform;
      if (s.rotate) s.el.style.rotate = s.rotate;
      if (s.scale) s.el.style.scale = s.scale;
    }
    card.style.removeProperty('scale');
    void card.offsetWidth;
    for (const s of saved) {
      s.el.style.transition = s.transition;
      originals.delete(s.el);
    }
    depth.set(card, 0);
  }
}
