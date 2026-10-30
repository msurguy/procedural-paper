import { PaperRenderer, buildParams, luminance, parseColor, type DeepPartial, type PaperParams, type SheetSpec } from './index';
import { resolveCard, type CardOptions, type CardRegion } from './cards';

export interface PaperSheetOptions {
  width: number;
  height: number;
  /** Texture preset (card preset IDs are used by createPaperCard instead). */
  preset?: string;
  params?: DeepPartial<PaperParams>;
  seed?: number;
  sheet?: Omit<SheetSpec, 'width' | 'height'>;
  /** Borrowed renderers are never disposed by the component. */
  renderer?: PaperRenderer;
}
export interface PaperCardOptions extends CardOptions { renderer?: PaperRenderer }
export interface PaperLayers {
  base: HTMLCanvasElement;
  shade: HTMLCanvasElement;
  shadow: HTMLCanvasElement;
  /** Mask includes the transparent sheet margin. No object URLs to release. */
  mask: string;
  maskPosition: string;
  maskSize: string;
}
/** Shared layer compositor, also used by the desk's interaction adapter. */
export function renderPaperLayers(renderer: PaperRenderer, params: PaperParams, spec: SheetSpec): PaperLayers {
  const result = renderer.renderSheet(params, spec, ['base', 'shade', 'shadow']);
  const k = result.pixelRatio, margin = result.margin / k;
  const make = (name: 'base' | 'shade' | 'shadow') => {
    const canvas = document.createElement('canvas');
    canvas.width = result.width; canvas.height = result.height;
    canvas.className = `pp-${name}`;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = `position:absolute;pointer-events:none;left:${-margin}px;top:${-margin}px;width:${result.width / k}px;height:${result.height / k}px`;
    canvas.getContext('2d')!.putImageData(new ImageData(result.maps[name]!.data as Uint8ClampedArray<ArrayBuffer>, result.width, result.height), 0, 0);
    return canvas;
  };
  const base = make('base'), shade = make('shade'), shadow = make('shadow');
  shade.style.mixBlendMode = 'hard-light';
  return { base, shade, shadow, mask: `url(${shade.toDataURL()})`, maskPosition: `${-margin}px ${-margin}px`, maskSize: `${result.width / k}px ${result.height / k}px` };
}
export interface PaperComponent<T> {
  element: HTMLDivElement;
  /** Append DOM nodes here; updates never replace caller-owned children. */
  slots: Record<string, HTMLDivElement>;
  update(options: Partial<T>): void;
  dispose(): void;
}
export function regionStyle(r: CardRegion): Record<string, string> {
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` };
}
export function resolveSheetOptions(options: PaperSheetOptions) {
  if (![options.width, options.height].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Paper dimensions must be positive finite numbers');
  return { params: buildParams(options.preset, options.params, options.seed), sheet: { seed: options.seed ?? 1, ...options.sheet, width: options.width, height: options.height }, regions: { content: { x: 0, y: 0, width: options.width, height: options.height } } };
}
export const paperInk = (params: PaperParams) => luminance(parseColor(params.color.base)) < 0.45 ? '#f4f1e8' : '#242323';

function create<T extends PaperSheetOptions | PaperCardOptions>(initial: T, isCard: boolean): PaperComponent<T> {
  const element = document.createElement('div');
  element.className = 'pp-paper';
  const shadow = document.createElement('div'); shadow.className = 'pp-shadow-layer';
  const surface = document.createElement('div'); surface.className = 'pp-surface';
  const base = document.createElement('div'); base.className = 'pp-base-layer';
  const content = document.createElement('div'); content.className = 'pp-content';
  const ruling = document.createElement('div'); ruling.className = 'pp-ruling'; ruling.setAttribute('aria-hidden', 'true');
  const shade = document.createElement('div'); shade.className = 'pp-shade-layer';
  content.append(ruling); surface.append(base, content, shade); element.append(shadow, surface);
  const slots: Record<string, HTMLDivElement> = {};
  let options = initial, owned: PaperRenderer | undefined, disposed = false;
  function update(patch: Partial<T>) {
    if (disposed) throw new Error('procedural-paper: component has been disposed');
    options = { ...options, ...patch };
    const resolved = isCard ? resolveCard(options as PaperCardOptions) : resolveSheetOptions(options as PaperSheetOptions);
    const { params, sheet, regions } = resolved;
    element.style.width = `${sheet.width}px`; element.style.height = `${sheet.height}px`;
    element.style.color = paperInk(params);
    surface.style.backgroundColor = params.color.base;
    ruling.dataset.ruling = 'preset' in resolved ? resolved.preset.ruling ?? '' : '';
    for (const [name, slot] of Object.entries(slots)) slot.hidden = !Object.hasOwn(regions, name);
    for (const [name, r] of Object.entries(regions)) {
      if (!slots[name]) { slots[name] = document.createElement('div'); slots[name].className = 'pp-slot'; slots[name].dataset.slot = name; content.append(slots[name]); }
      slots[name].hidden = false; Object.assign(slots[name].style, regionStyle(r));
    }
    base.replaceChildren(); shade.replaceChildren(); shadow.replaceChildren();
    content.style.maskImage = content.style.webkitMaskImage = '';
    element.dataset.rendered = 'fallback';
    try {
      const renderer = options.renderer ?? (owned ??= new PaperRenderer());
      if (!renderer.gl) return;
      const layers = renderPaperLayers(renderer, params, { pixelRatio: Math.min(2, window.devicePixelRatio || 1), ...sheet });
      base.append(layers.base); shade.append(layers.shade); shadow.append(layers.shadow);
      content.style.maskImage = content.style.webkitMaskImage = layers.mask;
      content.style.maskPosition = layers.maskPosition; content.style.maskSize = layers.maskSize; content.style.maskRepeat = 'no-repeat';
      surface.style.backgroundColor = 'transparent'; element.dataset.rendered = 'webgl2';
    } catch (error) {
      // Keep caller content readable if the GPU becomes unavailable.
      element.dispatchEvent(new CustomEvent('papererror', { detail: error }));
    }
  }
  update({});
  return { element, slots, update, dispose() { if (disposed) return; disposed = true; owned?.dispose(); element.remove(); } };
}
export const createPaperSheet = (options: PaperSheetOptions): PaperComponent<PaperSheetOptions> => create(options, false);
export const createPaperCard = (options: PaperCardOptions): PaperComponent<PaperCardOptions> => create(options, true);
