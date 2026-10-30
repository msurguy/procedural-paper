/**
 * Integer hashing shared bit-for-bit with the GLSL implementation (see gl/shaders.ts).
 * All values are uint32 represented as JS numbers in [0, 2^32).
 */

/** PCG-style integer hash (Jarzynski & Olano, "Hash Functions for GPU Rendering"). */
export function pcg(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** Hash of an integer lattice point + seed. `x`, `y` must be non-negative. */
export function hash2(x: number, y: number, seed: number): number {
  return pcg((x + pcg((y + pcg(seed)) >>> 0)) >>> 0);
}

/** uint32 -> float in [0, 1) using the top 24 bits (exact in float32). */
export function u01(h: number): number {
  return (h >>> 8) * (1 / 16777216);
}

/** Derive a per-layer seed from the user seed. */
export function layerSeed(seed: number, salt: number): number {
  return pcg((pcg(seed >>> 0) ^ Math.imul(salt, 0x9e3779b9)) >>> 0);
}
