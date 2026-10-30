/**
 * Optional pen-stroke handwriting via Tegaki (https://github.com/gkurt/tegaki).
 *
 * Tegaki is ~84 KB gz plus 25–130 KB gz per font, so nothing here is imported
 * statically: `enablePen()` pulls the engine and the font bundles in as lazy
 * chunks, and the motion `write` step asks the sync lookups below whether a
 * target can be drawn with real strokes (otherwise it keeps glyph / sweep).
 *
 * Each engine keeps the text as transparent, selectable DOM in its own font
 * (the ink is an aria-hidden canvas), so text stays readable to screen readers.
 */
import type { TegakiBundle, TegakiEngine } from 'tegaki/core';
import type { Font } from './fonts';

export interface PenFont {
  id: string;
  label: string;
  /** `outline`: a regular font Tegaki traced; `single`: a single-line (plotter) font drawn in its own strokes. */
  kind: 'outline' | 'single';
  /** The Google Font in fonts.ts this bundle is a drop-in for (cards already set in it get strokes as they are). */
  matches?: string;
  /** Visual size factor, like Font.size. */
  size: number;
  load: () => Promise<{ default: unknown }>;
}

// tegaki/fonts/nanum-pen-script is left out on purpose: its Korean glyph data is ~370 KB gz plus a 3.2 MB font
export const PEN_FONTS: PenFont[] = [
  { id: 'caveat', label: 'Caveat', kind: 'outline', matches: 'Caveat', size: 1.3, load: () => import('tegaki/fonts/caveat') },
  { id: 'hershey-script', label: 'Hershey Script', kind: 'single', size: 1.15, load: () => import('./pen-fonts/hershey-script/bundle') },
  { id: 'hershey-sans', label: 'Hershey Sans', kind: 'single', size: 0.95, load: () => import('./pen-fonts/hershey-sans/bundle') },
  { id: 'hershey-serif', label: 'Hershey Serif', kind: 'single', size: 0.95, load: () => import('./pen-fonts/hershey-serif/bundle') },
  { id: 'ems-allure', label: 'EMS Allure', kind: 'single', size: 1.25, load: () => import('./pen-fonts/ems-allure/bundle') },
  { id: 'ems-casual-hand', label: 'EMS Casual Hand', kind: 'single', size: 1.05, load: () => import('./pen-fonts/ems-casual-hand/bundle') },
  { id: 'ems-readability', label: 'EMS Readability', kind: 'single', size: 1.0, load: () => import('./pen-fonts/ems-readability/bundle') },
];

type Engine = typeof TegakiEngine;

let Engine: Engine | null = null;
/** Loaded bundles by PenFont id. */
const bundles = new Map<string, TegakiBundle>();
/** CSS family (Google name or bundle family, lowercased) → bundle. */
const byFamily = new Map<string, TegakiBundle>();
const pending = new Map<string, Promise<void>>();

async function loadFont(pf: PenFont, E: Engine) {
  const bundle = (await pf.load()).default as TegakiBundle;
  // the face pretext measures with (fit.ts) and the engine lays out in
  if (bundle.fontFaceCSS && !document.querySelector(`style[data-pen="${pf.id}"]`)) {
    const st = document.createElement('style');
    st.dataset.pen = pf.id;
    st.textContent = bundle.fontFaceCSS;
    document.head.appendChild(st);
  }
  await E.preload(bundle);
  bundles.set(pf.id, bundle);
  byFamily.set(bundle.family.toLowerCase(), bundle);
  if (pf.matches) byFamily.set(pf.matches.toLowerCase(), bundle);
}

/** Load the engine and the given fonts (all by default). Safe to call repeatedly. */
export async function enablePen(ids: string[] = PEN_FONTS.map((f) => f.id)): Promise<void> {
  const { TegakiEngine } = await import('tegaki/core');
  Engine = TegakiEngine;
  await Promise.all(
    ids.map((id) => {
      const pf = PEN_FONTS.find((f) => f.id === id);
      if (!pf || bundles.has(id)) return;
      if (!pending.has(id)) pending.set(id, loadFont(pf, TegakiEngine).catch((e) => console.warn(`[pen] ${id} failed to load`, e)));
      return pending.get(id);
    }),
  );
}

let on = false;
/** Whether the motion step should draw with Tegaki (the engine must also be loaded). */
export const setPen = (v: boolean) => (on = v);
export const penReady = () => on && !!Engine;
export const penEngine = () => Engine;

/** The bundle that draws text set in this CSS font-family list (first family wins). */
export function bundleFor(fontFamily: string): TegakiBundle | undefined {
  const first = fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  return byFamily.get(first);
}

/** Hershey / EMS have no curly single quotes or ellipsis: write those as the straight forms when the bundle lacks them. */
const STRAIGHT: Record<string, string> = { '‘': "'", '’': "'", '…': '...' };
export const penText = (s: string, bundle: TegakiBundle) => s.replace(/[‘’…]/g, (c) => (c in bundle.glyphData ? c : STRAIGHT[c]));

/** A loaded pen font as a fonts.ts Font, so cards can be set (and fitted) in it. */
export function penFontAsFont(id: string): Font | undefined {
  const pf = PEN_FONTS.find((f) => f.id === id);
  const b = bundles.get(id);
  if (!pf || !b) return undefined;
  return { family: pf.matches ?? b.family, size: pf.size, kind: 'hand' };
}

export const penContext = () => on && Engine ? { Engine, bundleFor } : undefined;
export const activePenBundles = () => on ? [...bundles.entries()] : [];
