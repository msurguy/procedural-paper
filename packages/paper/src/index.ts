import { renderCPU } from './cpu/renderer';
import { GLPaperRenderer, type GLCanvas, type PreviewView } from './gl/renderer';
import { defaultParams, mergeParams, type DeepPartial, type OutputMode, type PaperParams } from './params';
import { getPreset } from './presets';
import { resolveParams, type ResolvedPaper } from './resolve';
import type { PixelMap } from './export';
import { resolveSheet, scaleParams, type SheetOutput, type SheetSpec } from './sheet';

export interface SheetResult {
  /** Output size in device px, including the margin on every side. */
  width: number;
  height: number;
  /** Transparent border (device px) around the sheet. */
  margin: number;
  pixelRatio: number;
  maps: Partial<Record<SheetOutput, PixelMap>>;
}

export * from './params';
export * from './presets';
export * from './export';
export { parseColor, toHex, luminance, type RGB } from './color';
export { resolveParams, type ResolvedPaper } from './resolve';
export { GLPaperRenderer, type PreviewView, type GLCanvas } from './gl/renderer';
export { renderCPU } from './cpu/renderer';
export * from './sheet';

export type Backend = 'auto' | 'webgl2' | 'cpu';

export interface GenerateOptions {
  /** Preset id (see `presets`). Defaults to the neutral default paper. */
  preset?: string;
  /** Overrides applied on top of the preset. */
  params?: DeepPartial<PaperParams>;
  width: number;
  /** Defaults to `width`. */
  height?: number;
  /** Shortcut for `params.seed`. */
  seed?: number;
  /** Which maps to produce. Default: `['color']`. */
  outputs?: OutputMode[];
  backend?: Backend;
}

export interface PaperResult {
  width: number;
  height: number;
  params: PaperParams;
  backend: 'webgl2' | 'cpu';
  maps: Partial<Record<OutputMode, PixelMap>>;
}

/** Build the full parameter set from a preset id + overrides. */
export function buildParams(preset?: string, overrides?: DeepPartial<PaperParams>, seed?: number): PaperParams {
  const base = preset ? getPreset(preset).params : defaultParams;
  return mergeParams(base, overrides, seed !== undefined ? { seed } : undefined);
}

/**
 * A reusable renderer. Keeps one WebGL2 context alive (when available), which
 * is what you want for interactive editors.
 */
export class PaperRenderer {
  readonly backend: 'webgl2' | 'cpu';
  readonly gl: GLPaperRenderer | null;

  constructor(opts: { backend?: Backend; canvas?: GLCanvas } = {}) {
    const want = opts.backend ?? 'auto';
    let gl: GLPaperRenderer | null = null;
    if (want !== 'cpu') {
      try {
        gl = new GLPaperRenderer(opts.canvas);
      } catch (e) {
        if (want === 'webgl2') throw e;
      }
    }
    this.gl = gl;
    this.backend = gl ? 'webgl2' : 'cpu';
  }

  renderResolved(r: ResolvedPaper, outputs: OutputMode[]): Record<string, Uint8ClampedArray> {
    return this.gl ? this.gl.render(r, outputs) : renderCPU(r, outputs);
  }

  render(params: PaperParams, width: number, height = width, outputs: OutputMode[] = ['color']): PaperResult {
    const r = resolveParams(params, width, height);
    const data = this.renderResolved(r, outputs);
    const maps: PaperResult['maps'] = {};
    for (const m of outputs) maps[m] = { width: r.width, height: r.height, data: data[m] };
    return { width: r.width, height: r.height, params, backend: this.backend, maps };
  }

  /** WebGL only: render one map to the GPU and draw it tiled on the renderer's canvas. */
  preview(params: PaperParams, width: number, height: number, mode: OutputMode, view?: PreviewView) {
    if (!this.gl) throw new Error('procedural-paper: preview() needs the webgl2 backend');
    this.gl.renderToTexture(resolveParams(params, width, height), mode);
    this.gl.drawPreview(view);
  }

  /**
   * Render a finite sheet of paper with an outline, holes, relief and shadow
   * (WebGL2 only). `params` describe the paper at 1 CSS px per px; the sheet's
   * `pixelRatio` scales them up for crisp output.
   */
  renderSheet(params: PaperParams, sheet: SheetSpec, outputs: SheetOutput[] = ['color']): SheetResult {
    if (!this.gl) throw new Error('procedural-paper: renderSheet() needs the webgl2 backend');
    const s = resolveSheet(sheet);
    const r = resolveParams(scaleParams(params, s.pixelRatio), s.width, s.height);
    const data = this.gl.renderSheet(r, s, outputs);
    const W = s.width + 2 * s.margin;
    const H = s.height + 2 * s.margin;
    const maps: SheetResult['maps'] = {};
    for (const m of outputs) maps[m] = { width: W, height: H, data: data[m] };
    return { width: W, height: H, margin: s.margin, pixelRatio: s.pixelRatio, maps };
  }

  dispose() {
    this.gl?.dispose();
  }
}

let shared: PaperRenderer | null = null;

/** One-shot generation. Uses a shared WebGL2 renderer when possible, else the CPU. */
export async function generatePaper(opts: GenerateOptions): Promise<PaperResult> {
  const params = buildParams(opts.preset, opts.params, opts.seed);
  const backend = opts.backend ?? 'auto';
  let renderer: PaperRenderer;
  if (backend === 'cpu') renderer = new PaperRenderer({ backend: 'cpu' });
  else {
    if (!shared || (backend === 'webgl2' && shared.backend !== 'webgl2')) shared = new PaperRenderer({ backend });
    renderer = shared;
  }
  return renderer.render(params, opts.width, opts.height ?? opts.width, opts.outputs ?? ['color']);
}

export * from './stocks';
export * from './cards';
