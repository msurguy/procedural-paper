/** Small seeded PRNG (mulberry32) with helpers. */
export interface Rng {
  (): number;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(a: readonly T[]): T;
  chance(p: number): boolean;
  weighted<T>(items: readonly T[], weight: (t: T) => number): T;
  fork(): Rng;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = next as Rng;
  r.range = (a, b) => a + (b - a) * next();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  r.pick = (a) => a[Math.floor(next() * a.length)];
  r.chance = (p) => next() < p;
  r.weighted = (items, weight) => {
    const total = items.reduce((t, i) => t + weight(i), 0);
    let x = next() * total;
    for (const i of items) if ((x -= weight(i)) < 0) return i;
    return items[items.length - 1];
  };
  r.fork = () => makeRng(Math.floor(next() * 4294967296));
  return r;
}
