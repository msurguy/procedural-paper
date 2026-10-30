export type RGB = [number, number, number];

/** Parse `#rgb`, `#rrggbb` (or `rgb(r,g,b)`) into 0..1 sRGB components. */
export function parseColor(input: string): RGB {
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex.slice(0, 3)].map((ch) => ch + ch).join('');
    const v = parseInt(hex.slice(0, 6), 16);
    if (Number.isNaN(v)) return [0, 0, 0];
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  const m = s.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  return [0, 0, 0];
}

export function toHex([r, g, b]: RGB): string {
  const h = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function luminance([r, g, b]: RGB): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
