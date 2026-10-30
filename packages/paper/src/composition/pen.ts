import type { TegakiBundle, TegakiEngine } from 'tegaki/core';
export interface PenContext {
  Engine: typeof TegakiEngine;
  bundleFor(family: string): TegakiBundle | undefined;
}
const STRAIGHT: Record<string, string> = { '‘': "'", '’': "'", '…': '...' };
export const penText = (s: string, bundle: TegakiBundle) => s.replace(/[‘’…]/g, c => c in bundle.glyphData ? c : STRAIGHT[c]);
