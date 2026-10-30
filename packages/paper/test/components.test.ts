// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { cardPresetIds, cardPresets, getCardPreset, resolveCard, PaperRenderer } from '../src/index';
import { createPaperCard, createPaperSheet } from '../src/dom';
import { PaperCard } from '../src/react';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
afterEach(() => document.body.replaceChildren());

describe('public presets', () => {
  it('covers all desk styles with usable independent deterministic recipes', () => {
    expect(cardPresets.map(p => p.id)).toEqual([...cardPresetIds]);
    expect(new Set(cardPresetIds).size).toBe(25);
    for (const id of cardPresetIds) {
      const a = resolveCard({ preset: id, seed: 42 });
      expect(a).toEqual(resolveCard({ preset: id, seed: 42 }));
      expect(a.params.seed).toBe(42);
      expect(a.sheet.seed).toBe(42);
      for (const r of Object.values(a.regions)) {
        expect(r.width).toBeGreaterThan(0); expect(r.height).toBeGreaterThan(0);
        expect(r.x + r.width).toBeLessThanOrEqual(a.sheet.width);
        expect(r.y + r.height).toBeLessThanOrEqual(a.sheet.height);
      }
    }
    const p = getCardPreset('tag'); p.sheet.shape!.holes![0].x = 0;
    expect(getCardPreset('tag').sheet.shape!.holes![0].x).toBe(70);
  });
  it('scales cutouts and regions with explicit dimensions', () => {
    const tag = resolveCard({ preset: 'tag', width: 280, height: 510 });
    expect(tag.sheet.shape!.holes![0]).toMatchObject({ x: 140, y: 56, r: 6 });
    expect(tag.regions.content.width).toBe(232);
    expect(resolveCard({ preset: 'stamp' }).sheet.shape!.holeRows).toHaveLength(4);
    expect(resolveCard({ preset: 'notebook' }).sheet.shape!.holeRows![0].tear).toBeGreaterThan(0);
    expect(resolveCard({ preset: 'memo' }).sheet.relief!.folds!.y).toBe(3);
  });
});

describe('vanilla lifecycle without a GPU', () => {
  it('preserves content nodes, handlers and slots across changes', () => {
    const card = createPaperCard({ preset: 'polaroid' });
    const button = document.createElement('button'); const clicked = vi.fn();
    button.textContent = 'Click'; button.onclick = clicked;
    card.slots.content.append(button); document.body.append(card.element);
    const slot = card.slots.content;
    card.update({ seed: 2, width: 300 }); button.click();
    expect(clicked).toHaveBeenCalledOnce(); expect(card.slots.content).toBe(slot);
    expect(card.element.dataset.rendered).toBe('fallback');
    card.update({ preset: 'sticky' }); expect(card.slots.photo.hidden).toBe(true);
    card.update({ preset: 'polaroid' }); expect(card.slots.photo.hidden).toBe(false);
    card.dispose(); card.dispose(); expect(document.body.contains(button)).toBe(false);
    expect(() => card.update({ seed: 3 })).toThrow('disposed');
  });
  it('does not dispose a borrowed renderer', () => {
    const renderer = new PaperRenderer({ backend: 'cpu' }); const dispose = vi.spyOn(renderer, 'dispose');
    const sheet = createPaperSheet({ width: 120, height: 80, renderer });
    sheet.dispose(); expect(dispose).not.toHaveBeenCalled(); renderer.dispose();
  });
  it('rejects bad IDs and dimensions before allocating a renderer', () => {
    expect(() => createPaperCard({ preset: 'missing' as any })).toThrow('unknown card');
    for (const width of [0, -1, NaN, Infinity]) expect(() => createPaperSheet({ width, height: 50 })).toThrow(RangeError);
  });
});

it('React SSR and Strict Mode keep live children across updates and clean up', async () => {
  const props = { preset: 'polaroid' as const, slots: { photo: h('img', { src: '/photo.jpg', alt: 'Lake' }) } };
  expect(renderToString(h(PaperCard, props, 'Summer'))).toContain('Summer');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(h(StrictMode, null, h(PaperCard, props, h('input', { defaultValue: 'Original' })))));
  const input = host.querySelector('input')!; input.value = 'User edit';
  await act(async () => root.render(h(StrictMode, null, h(PaperCard, { ...props, seed: 8 }, h('input', { defaultValue: 'Original' })))));
  expect(host.querySelector('input')).toBe(input); expect(input.value).toBe('User edit');
  expect(host.querySelector('img')?.alt).toBe('Lake');
  await act(async () => root.unmount()); expect(host.children).toHaveLength(0);
});
