import { PaperRenderer } from '../index';
import { createSceneRenderer, type BuiltCard } from './renderer';
import { createPhotoRenderer } from './photos';
import { materializeNode, describeNode } from './nodes';
import { loadCompositionAssets } from './assets';
import { filterMarkup } from './filters';
import { makeRng } from './rng';
import { validateComposition, type AssetResolver, type PaperComposition } from './model';
import type { CardPlan } from './scene';
import type { CardMotion } from './motion';
export * from './model';
export type { CompositionNode } from './model';
export interface CompositionOptions {
  composition: PaperComposition;
  resolveAsset: AssetResolver;
  autoplay?: boolean;
  fit?: 'natural' | 'contain';
  renderer?: PaperRenderer;
}
export interface CompositionHandle {
  element: HTMLDivElement;
  readonly ready: Promise<void>;
  readonly rendered: boolean;
  update(options: Partial<CompositionOptions>): Promise<void>;
  play(): void; pause(): void; replay(): void; seek(progress: number): void;
  dispose(): void;
}
let instance = 0;
export function hydrateComposition(composition: PaperComposition, scope: string): CardPlan {
  return {
    w: composition.width, h: composition.height, rot: composition.rotation, paper: composition.paper,
    params: composition.params, look: composition.sheet, info: composition.info,
    ink: composition.content ? materializeNode(composition.content, scope) as HTMLElement : null,
    attach: composition.attachments.map(a => a.type === 'html' ? { ...a, el: materializeNode(a.node, scope) as HTMLElement } : structuredClone(a)),
    motion: composition.motion,
  };
}
/** Use the same SVG filter definitions, with instance-local IDs. */
export function mountCompositionFilters(host: HTMLElement, scope: string) {
  const template = document.createElement('template'); template.innerHTML = filterMarkup;
  const svg = materializeNode(describeNode(template.content.firstElementChild!), scope);
  host.append(svg);
  for (const name of ['ink','pencil','stamp','wash','stain']) host.style.setProperty(`--pc-f-${name}`, `url(#${scope}-f-${name})`);
}
export function createPaperComposition(initial: CompositionOptions): CompositionHandle {
  let options = initial, revision = 0, disposed = false, rendered = false;
  const element = document.createElement('div'); element.className = 'pc-composition';
  let motion: CardMotion | null = null;
  let cleanup = () => {};
  let currentReady: Promise<void> = Promise.resolve();
  const scope = `pc-${++instance}`;
  let resize: ResizeObserver | undefined;
  function bounds(built: BuiltCard, rotation: number) {
    const root = built.el; root.style.transform = 'none';
    const base = root.getBoundingClientRect();
    let minX = -24, minY = -24, maxX = root.offsetWidth + 24, maxY = root.offsetHeight + 24;
    for (const canvas of root.querySelectorAll('canvas')) {
      if (canvas.classList.contains('lifted')) continue;
      const rect = canvas.getBoundingClientRect();
      minX = Math.min(minX, rect.left - base.left); minY = Math.min(minY, rect.top - base.top);
      maxX = Math.max(maxX, rect.right - base.left); maxY = Math.max(maxY, rect.bottom - base.top);
    }
    for (const decoration of root.querySelectorAll('.front > *, .back > *')) {
      const rect = decoration.getBoundingClientRect();
      minX = Math.min(minX, rect.left - base.left - 8); minY = Math.min(minY, rect.top - base.top - 8);
      maxX = Math.max(maxX, rect.right - base.left + 8); maxY = Math.max(maxY, rect.bottom - base.top + 8);
    }
    const a = rotation * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
    const corners = [[minX,minY],[maxX,minY],[maxX,maxY],[minX,maxY]].map(([x,y]) => [x*cs-y*sn,x*sn+y*cs]);
    const left = Math.min(...corners.map(p=>p[0])), top = Math.min(...corners.map(p=>p[1]));
    const width = Math.max(...corners.map(p=>p[0]))-left, height = Math.max(...corners.map(p=>p[1]))-top;
    const resizeToFit = () => {
      const available = element.parentElement?.clientWidth ?? width;
      const scale = options.fit === 'contain' ? Math.min(1, available / width) : 1;
      element.style.width = `${width * scale}px`; element.style.height = `${height * scale}px`;
      root.style.left = `${-left * scale}px`; root.style.top = `${-top * scale}px`;
      root.style.transform = `scale(${scale}) rotate(${rotation}deg)`;
    };
    resizeToFit();
    if (options.fit === 'contain' && element.parentElement) { resize = new ResizeObserver(resizeToFit); resize.observe(element.parentElement); }
  }
  async function render() {
    if (disposed) return;
    const token = ++revision; cleanup(); resize?.disconnect(); motion = null; rendered = false;
    element.replaceChildren(); element.dataset.rendered = 'loading';
    const config = options, value = structuredClone(config.composition); validateComposition(value);
    const fallback = document.createElement('div'); fallback.style.cssText = `width:${value.width}px;height:${value.height}px;background:${value.params.color.base}`;
    fallback.textContent = value.info.kind; element.append(fallback);
    const loaded = await loadCompositionAssets(value.assets, config.resolveAsset, value.pen);
    if (disposed || token !== revision) { loaded.dispose(); return; }
    const renderer = config.renderer ?? new PaperRenderer();
    const photos = createPhotoRenderer(id => {
      const asset = value.assets.find(a => a.id === id); if (!asset?.photo) throw new Error(`Missing photo metadata: ${id}`); return asset.photo;
    }, id => { const url = loaded.urls.get(id); if (!url) throw new Error(`Missing photo asset: ${id}`); return url; }, () => value.environment.pixelRatio);
    const scene = createSceneRenderer({ renderer, photos, light: value.environment.light, grain: () => value.environment.grain, pixelRatio: () => value.environment.pixelRatio });
    let localMotion: CardMotion | null = null;
    let released = false;
    const release = () => { if (released) return; released = true; localMotion?.dispose(); photos.dispose(); scene.dispose(); if (!config.renderer) renderer.dispose(); loaded.dispose(); };
    cleanup = release;
    try {
      const plan = hydrateComposition(value, scope);
      element.replaceChildren(); mountCompositionFilters(element, scope);
      const built = scene.buildCard(plan); element.append(built.el);
      if (!renderer.gl) {
        built.paper.style.background = value.params.color.base;
        if (plan.ink) built.paper.append(plan.ink);
        element.dataset.rendered = 'fallback'; bounds(built, value.rotation); return;
      }
      await built.render(value.rotation);
      if (disposed || token !== revision) { release(); return; }
      if (value.motion?.steps.length && plan.ink) {
        const { prepareMotion } = await import('./motion');
        if (disposed || token !== revision) { release(); return; }
        localMotion = prepareMotion(plan, built, makeRng(value.motionSeed), loaded.penContext);
        motion = localMotion;
        if (config.autoplay !== false) motion?.play(); else motion?.finish();
      }
      bounds(built, value.rotation);
      rendered = true; element.dataset.rendered = 'webgl2';
    } catch (error) {
      release();
      throw error;
    }
  }
  function startRender() {
    const task = render(), token = revision;
    return task.catch(error => {
      if (token === revision && !disposed) { element.dataset.rendered = 'error'; element.dispatchEvent(new CustomEvent('papererror', { detail: error })); }
      throw error;
    });
  }
  currentReady = Promise.resolve().then(() => { if (!revision && !disposed) return startRender(); });
  // Callers can await ready; avoid an unhandled rejection before they attach a listener.
  void currentReady.catch(() => {});
  return {
    element, get ready() { return currentReady; }, get rendered() { return rendered; },
    update(patch) { if (disposed) return Promise.reject(new Error('Composition disposed')); options = { ...options, ...patch }; currentReady = startRender(); void currentReady.catch(() => {}); return currentReady; },
    play() { motion?.resume(); }, pause() { motion?.pause(); }, replay() { motion?.replay(); }, seek(p) { motion?.seek(p); },
    dispose() { if (disposed) return; disposed = true; revision++; resize?.disconnect(); cleanup(); element.remove(); },
  };
}
