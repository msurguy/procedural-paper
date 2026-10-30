import { prepareMotion as prepare, type CardMotion } from '../../../../packages/paper/src/composition/motion';
import type { MotionStep } from './motion-spec';
import type { CardPlan } from './cards';
import type { BuiltCard } from './render';
import type { Rng } from './rng';
import { penContext } from './handwriting';
import { captureMotion } from './composition-capture';
export { prefersReducedMotion, type CardMotion } from '../../../../packages/paper/src/composition/motion';
const MAX_BRUSH_PER_CARD = 3, MAX_BRUSH_PER_DESK = 60;
let brushBudget = MAX_BRUSH_PER_DESK;
export const resetMotionBudget = () => (brushBudget = MAX_BRUSH_PER_DESK);
/** Which steps run, after the brush budget (lowest priority dropped first). */
function budget(steps: MotionStep[]): MotionStep[] {
  const brushes = steps.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'brush');
  const keep = new Set(
    brushes
      .sort((a, b) => (b.s.priority ?? 0) - (a.s.priority ?? 0) || a.i - b.i)
      .slice(0, Math.min(MAX_BRUSH_PER_CARD, brushBudget))
      .map((x) => x.i),
  );
  brushBudget -= keep.size;
  return steps.filter((s, i) => s.kind !== 'brush' || keep.has(i));
}


export function prepareMotion(plan: CardPlan, built: BuiltCard, rng: Rng): CardMotion | null {
  if (!plan.motion) return null;
  const spec = { ...plan.motion, steps: budget(plan.motion.steps) };
  captureMotion(built, spec, plan.ink);
  return prepare({ ...plan, motion: spec }, built, rng, penContext());
}
