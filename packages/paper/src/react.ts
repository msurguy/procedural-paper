// The build adds a 'use client' directive to this public entry point.
import { createElement as h, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { PaperRenderer } from './index';
import { resolveCard } from './cards';
import { paperInk, regionStyle, renderPaperLayers, resolveSheetOptions, type PaperCardOptions, type PaperSheetOptions } from './dom';

type ContentProps = { children?: ReactNode; slots?: Record<string, ReactNode>; className?: string; style?: CSSProperties; 'aria-label'?: string };
export type PaperSheetProps = PaperSheetOptions & ContentProps;
export type PaperCardProps = PaperCardOptions & ContentProps;
function PaperView({ options, card, children, slots, className, style, 'aria-label': label }: ContentProps & { options: PaperSheetOptions | PaperCardOptions; card: boolean }) {
  const resolved = card ? resolveCard(options as PaperCardOptions) : resolveSheetOptions(options as PaperSheetOptions);
  const { params, sheet, regions } = resolved;
  const base = useRef<HTMLDivElement>(null), shade = useRef<HTMLDivElement>(null), shadow = useRef<HTMLDivElement>(null);
  const [mask, setMask] = useState<CSSProperties | null>(null);
  const { renderer, preset, width, height, seed, params: overrides, sheet: sheetOverrides } = options;
  useEffect(() => {
    let owned: PaperRenderer | undefined;
    setMask(null);
    try {
      const r = renderer ?? (owned = new PaperRenderer());
      if (r.gl) {
        const current = card ? resolveCard(options as PaperCardOptions) : resolveSheetOptions(options as PaperSheetOptions);
        const layers = renderPaperLayers(r, current.params, { pixelRatio: Math.min(2, window.devicePixelRatio || 1), ...current.sheet });
        base.current?.replaceChildren(layers.base); shade.current?.replaceChildren(layers.shade); shadow.current?.replaceChildren(layers.shadow);
        setMask({ maskImage: layers.mask, WebkitMaskImage: layers.mask, maskPosition: layers.maskPosition, maskSize: layers.maskSize, maskRepeat: 'no-repeat' });
      }
    } catch { /* Plain paper and live children remain usable without a GPU. */ }
    const nodes = [base.current, shade.current, shadow.current];
    return () => { nodes.forEach(n => n?.replaceChildren()); owned?.dispose(); };
    // These are every rendering input; caller content never causes a texture render.
  }, [card, renderer, preset, width, height, seed, overrides, sheetOverrides]);
  return h('div', { className: `pp-paper ${className ?? ''}`, 'aria-label': label, 'data-rendered': mask ? 'webgl2' : 'fallback', style: { width: sheet.width, height: sheet.height, color: paperInk(params), ...style } },
    h('div', { className: 'pp-shadow-layer', ref: shadow, 'aria-hidden': true }),
    h('div', { className: 'pp-surface', style: { backgroundColor: mask ? 'transparent' : params.color.base } },
      h('div', { className: 'pp-base-layer', ref: base, 'aria-hidden': true }),
      h('div', { className: 'pp-content', style: mask ?? undefined },
        h('div', { className: 'pp-ruling', 'aria-hidden': true, 'data-ruling': 'preset' in resolved ? resolved.preset.ruling : undefined } as HTMLAttributes<HTMLDivElement>),
        ...Object.entries(regions).map(([name, r]) => h('div', { key: name, className: 'pp-slot', 'data-slot': name, style: regionStyle(r) }, name === 'content' ? children ?? slots?.content : slots?.[name]))),
      h('div', { className: 'pp-shade-layer', ref: shade, 'aria-hidden': true })));
}
export function PaperSheet({ children, slots, className, style, 'aria-label': label, ...options }: PaperSheetProps) {
  return h(PaperView, { options, card: false, children, slots, className, style, 'aria-label': label });
}
export function PaperCard({ children, slots, className, style, 'aria-label': label, ...options }: PaperCardProps) {
  return h(PaperView, { options, card: true, children, slots, className, style, 'aria-label': label });
}
