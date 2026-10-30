import fontAssets from './font-assets.json';
/** Google Fonts used by the cards. `size` normalizes visual x-height across faces. */
export interface Font {
  family: string;
  size: number;
  kind: 'hand' | 'mono';
  /** Marker-style faces read best large and short. */
  marker?: boolean;
  weight?: string;
}

export const HAND: Font[] = [
  { family: 'Caveat', size: 1.3, kind: 'hand', weight: ':wght@400;600' },
  { family: 'Kalam', size: 0.95, kind: 'hand', weight: ':wght@300;400' },
  { family: 'Patrick Hand', size: 1.08, kind: 'hand' },
  { family: 'Shadows Into Light', size: 1.12, kind: 'hand' },
  { family: 'Reenie Beanie', size: 1.5, kind: 'hand' },
  { family: 'Gochi Hand', size: 1.08, kind: 'hand' },
  { family: 'Nanum Pen Script', size: 1.55, kind: 'hand' },
  { family: 'Indie Flower', size: 1.0, kind: 'hand' },
  { family: 'Homemade Apple', size: 0.82, kind: 'hand' },
  { family: 'Covered By Your Grace', size: 1.25, kind: 'hand' },
  { family: 'Gaegu', size: 1.2, kind: 'hand' },
  { family: 'Architects Daughter', size: 0.95, kind: 'hand' },
  { family: 'Just Another Hand', size: 1.5, kind: 'hand' },
  { family: 'Rock Salt', size: 0.72, kind: 'hand', marker: true },
  { family: 'Permanent Marker', size: 0.95, kind: 'hand', marker: true },
];

export const MONO: Font[] = [
  { family: 'Special Elite', size: 1.0, kind: 'mono' },
  { family: 'Courier Prime', size: 1.02, kind: 'mono', weight: ':wght@400;700' },
  { family: 'IBM Plex Mono', size: 0.92, kind: 'mono', weight: ':wght@400;600' },
  { family: 'Space Mono', size: 0.9, kind: 'mono', weight: ':wght@400;700' },
  { family: 'JetBrains Mono', size: 0.9, kind: 'mono', weight: ':wght@400;700' },
  { family: 'Cutive Mono', size: 1.05, kind: 'mono' },
  { family: 'VT323', size: 1.3, kind: 'mono' },
  { family: 'Major Mono Display', size: 0.82, kind: 'mono' },
];

export const TYPEWRITER = MONO.filter((f) => ['Special Elite', 'Courier Prime', 'Cutive Mono'].includes(f.family));
export const RECEIPT = MONO.filter((f) => ['VT323', 'Space Mono', 'IBM Plex Mono', 'JetBrains Mono', 'Courier Prime'].includes(f.family));
export const PEN = HAND.filter((f) => !f.marker);

export function loadFonts() {
  const style = document.createElement('style');
  style.textContent = fontAssets.map(a => `@font-face{font-family:'${a.family}';src:url('${new URL('../', location.href).pathname}${a.file}');font-weight:${a.descriptors.weight};font-style:${a.descriptors.style};unicode-range:${a.descriptors.unicodeRange};font-display:block}`).join('\n');
  document.head.append(style);
}

export const css = (f: Font, px: number) => `font-family:'${f.family}',${f.kind === 'mono' ? 'monospace' : 'cursive'};font-size:${(px * f.size).toFixed(1)}px`;
