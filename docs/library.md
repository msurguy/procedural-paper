# procedural-paper API

MIT © 2026 Maks Surguy. [Source](https://github.com/msurguy/procedural-paper) · [Demo](https://msurguy.github.io/procedural-paper/)

Seamless procedural paper textures and 25 paper UI components, generated from
code without source images.

```sh
npm install procedural-paper
```

## Entry points

| Import | Purpose |
| --- | --- |
| `procedural-paper` | Dependency-free texture/sheet rendering, stock recipes, card presets |
| `procedural-paper/dom` | `createPaperSheet`, `createPaperCard`, shared `renderPaperLayers` compositor |
| `procedural-paper/react` | `PaperSheet`, `PaperCard`; requires React 18.2+ or 19 |
| `procedural-paper/styles.css` | Required, namespaced component styling |

Build output is ESM with TypeScript declarations. CPU texture generation works in
Node without a DOM. DOM helpers must be called in the browser. React components
are SSR-safe and hydrate a plain paper container before rendering textures.

## Textures

```ts
import { generatePaper, encodePNG } from 'procedural-paper';
const paper = await generatePaper({
  preset: 'watercolor-cold-press', width: 1024, height: 768, seed: 7,
  outputs: ['color', 'albedo', 'overlay', 'height', 'normal'],
  params: { color: { base: '#f4efe4' } },
  backend: 'auto', // or 'webgl2' / 'cpu'
});
const png = await encodePNG(paper.maps.color!);
```

`presets`, `paramSchema`, `buildParams`, `mergeParams`, `getParam` and `setParam`
provide discovery and editing. `toBlob` and `toCanvas` provide browser outputs.
Reuse `PaperRenderer` for repeated work and call `dispose()` when finished.
`preview()` and `renderSheet()` require WebGL2; CPU rendering covers repeating maps.

## Vanilla components

```ts
import { createPaperCard, createPaperSheet } from 'procedural-paper/dom';
import 'procedural-paper/styles.css';
const card = createPaperCard({ preset: 'polaroid', seed: 4 });
const photo = document.createElement('img');
photo.src = '/my-photo.jpg'; photo.alt = 'A mountain lake';
card.slots.photo.append(photo);
card.slots.content.textContent = 'Summer';
document.body.append(card.element);
card.update({ seed: 5 }); // preserves content nodes and listeners
// card.dispose(); // removes element and releases its owned renderer

const sheet = createPaperSheet({ width: 240, height: 320, preset: 'kraft',
  sheet: { shape: { edges: { left: 'torn' } } } });
```

Card options: `preset`, optional `width`, `height`, `seed`, paper `params`, sheet
`sheet` overrides, and optional borrowed `renderer`. Sheet options require
`width` and `height`; their `preset` is a texture preset instead of a card ID.
Dimensions are explicit CSS pixels, not automatically measured from children.
Pixel ratio defaults to device pixel ratio capped at 2; override with `sheet.pixelRatio`.
Card geometry and content regions scale with width/height. Hole radii and edge
texture detail remain in CSS pixels. `params` merges into the stock recipe;
`sheet` replaces top-level preset sheet groups. `update` shallow-merges options;
pass `undefined` to clear an optional override. `sheet.seed` overrides the outline seed.

`slots` contains live DOM containers for all regions. Unused regions are empty;
when switching preset, former slots are hidden and retained for reuse. Caller
content is never interpreted as HTML strings. Text remains selectable and controls
remain interactive; canvases and shading do not intercept pointer events.
Consumers own their content's event handlers and any object URLs they create.
A borrowed renderer is never disposed by a component.

If the GPU is unavailable, components retain readable content on a solid paper
background. Rendering failures emit `papererror` on the vanilla element. Invalid
preset IDs or non-positive/non-finite dimensions throw before rendering.

## React

```tsx
import { PaperCard, PaperSheet } from 'procedural-paper/react';
import 'procedural-paper/styles.css';
export function Example() {
  return <PaperCard preset="polaroid" seed={4}
    slots={{ photo: <img src="/my-photo.jpg" alt="A mountain lake" /> }}>
    Summer
  </PaperCard>;
}
```

Props mirror vanilla options plus `children`, `slots`, `className`, `style`, and
`aria-label`. `children` fills `content`; `slots` supplies named React regions.
React owns the children throughout updates. Memoize parameter/sheet objects and
borrow a renderer when rendering many components. Effects clean up on unmount
and support Strict Mode. The wrapper is marked as a client entry point for React
server-component frameworks; CSS should be imported at the application's entry.

## Card presets

`cardPresetIds` and `cardPresets` enumerate all 25 styles. `getCardPreset(id)`
returns an independent copy. `resolveCard(options)` returns paper parameters,
sheet settings and named content regions without accessing the DOM.

| IDs | Regions in addition to `content` |
| --- | --- |
| sticky, notebook, napkin, scrap, graph, biz, quote, tag, receipt | none |
| index | title |
| ticket | stub |
| memo | signature |
| watercolor, clipping, stamp, tracing, tapelabel, print | none |
| polaroid, photonote, vintage, tear | photo |
| album | photo1, photo2, caption2 |
| booth | photo1, photo2, photo3, photo4 |
| film | photo1, photo2, photo3 |

`paperStocks` and `stockParams(key)` expose the desk's paper recipes. Presets
include outlines, relief, photo regions and ruled/grid decorations. Supply your
own content and images. The library doesn't bundle photos, fonts, sample prose,
photo grading, text fitting, attachments, physics, or handwriting animations.

## Low-level sheets

```ts
import { PaperRenderer, buildParams } from 'procedural-paper';
const renderer = new PaperRenderer();
const result = renderer.renderSheet(buildParams('kraft'), {
  width: 240, height: 320, pixelRatio: 2,
  shape: { edges: { left: 'torn' } },
}, ['base', 'shade', 'shadow']);
renderer.dispose();
```

Place live content between base and shade; shade uses `mix-blend-mode: hard-light`.
`renderPaperLayers(renderer, params, sheet)` performs the browser canvas conversion
and returns canvases plus mask CSS. Its output includes the transparent margin;
the helper creates no object URLs. This is also how the desk integrates its own
interaction layers with the library.

## Export an exact desk component

Select a rendered card in the **Desk** tab, then choose **Export React** or
**Export Vanilla**. The dialog previews that card independently, including its
paper, editable text, photographs, tape, pins, cords, shadows and content motion.
Choose a file to copy, or download the ZIP to get the complete example.

The ZIP contains both framework examples, `composition.json`, a static asset
resolver, selected local photographs and fonts, optional pen data, credits and
licenses, and a small Vite application. Run `npm install` then `npm run dev` in
that folder. Assets work without Google
Fonts or other external services; installing dependencies still requires an
available package source.

```ts
import { createPaperComposition } from 'procedural-paper/composition';
import 'procedural-paper/composition.css';
import { resolveAsset } from './assets';
import data from './composition.json';
import type { PaperComposition } from 'procedural-paper/composition';

const paper = createPaperComposition({
  composition: data as unknown as PaperComposition,
  resolveAsset,
  fit: 'contain',
});
document.querySelector('#app')!.append(paper.element);
await paper.ready;
// paper.play(), paper.pause(), paper.replay(), paper.seek(0.5)
// paper.dispose() when removing the component.
```

React uses `PaperComposition` from `procedural-paper/composition/react`, with the
same options and an optional ref exposing playback controls. It cleans up on
unmount and reports asynchronous failures through `onError`. `onReady` signals
completion. The vanilla handle supports `update(options)` and `ready`.

Composition entry points are optional and do not add their renderers or motion
libraries to the base texture API. Install `@chenglou/pretext@0.0.9` for composition
text fitting, `brushmark@0.1.2`, and `tegaki@1.1.0` when bundling the composition
entry. Motion and pen engines load lazily at runtime; bundlers still need these
peers available to resolve their chunks. React itself remains an optional peer dependency.

The version 1 composition model records local dimensions, material parameters,
lighting, texture scale, rotation, stable content node IDs, fitting inputs,
attachment geometry, photo grading, asset metadata and resolved motion steps.
The desk and exported components share the same rendering algorithms. Texture
images are generated; desk background scans are never part of a component export.
The runtime renders at fixed dimensions and can scale the entire result to its
container with `fit: 'contain'`.

Use `setCompositionText(composition, nodeId, newText)` to create an edited copy.
Fitted text is measured again and animation references within the changed block
are moved to that block. For richer changes, edit the node tree directly and keep
its animation references valid. To change photos, update their asset records,
resolver URLs and photo specifications. Exported JSON is configuration for your
own application; it is not a general HTML import format.

The asset resolver must return a URL for every declared asset. Missing assets
reject `ready` instead of silently substituting photos. WebGL2 is required for
full visual fidelity; the runtime marks a readable material/content fallback with
`data-rendered="fallback"` and `rendered === false`. Reduced-motion preferences
finish content immediately. Dragging, peeling, selection highlights and the desk
background belong to the demo and are excluded from component exports.
