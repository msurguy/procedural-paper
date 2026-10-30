# Rendering architecture

Procedural paper textures that tile seamlessly, generated at any size. Choose from paper presets in several families (drawing, construction, pastel, handmade, watercolor, craft and cardboard) or change any of about 50 parameters. The library can export these maps:

- **color**: the lit paper
- **albedo**: the paper colour without lighting
- **overlay**: a neutral-gray version for blend modes
- **height**
- **normal**

Rendering uses a WebGL2 shader. A pure-JS fallback runs the same algorithm, so it also works in Node, in workers, and on machines without a GPU. CPU and GPU implementations share the same seeded procedural model; floating-point rounding can differ.

```
packages/paper      the library (ESM + TypeScript; dependency-free texture core)
apps/demo          unified Exporter and Desk demo
```

## Quick start

```bash
pnpm install
pnpm dev        # unified demo on http://localhost:5173
pnpm desk       # Paper Desk demo
pnpm test       # seam, determinism and schema tests (CPU backend)
pnpm build      # library -> packages/paper/dist, demo -> apps/demo/dist
```

## Overlays: crumples, folds, stains

Three optional parameter groups add sheet-scale wear. They are inspired by the [Paper Shaders](https://github.com/paper-design/shaders) `paper-texture` shader (Apache-2.0) and reworked so they still tile seamlessly and match between GPU and CPU:

- **crumples**: faceted creases. The surface is built from random heights on a jittered periodic lattice, triangulated and linearly interpolated, so every facet is a plane and every crease a sharp edge. There is a second, finer layer for wrinkles.
- **folds**: fold lines across the tile. The panels between folds tilt, each crease has a small ridge, and worn fibres darken along the fold.
- **stains**: coffee and water rings, each with a darker tide line.

Their relief is normalised by `lighting.depth`, so the same strength reads the same on every paper.

```ts
generatePaper({ preset: 'kraft', width: 1024, params: {
  crumples: { strength: 0.8, size: 140, wrinkles: 0.4 },
  folds: { strength: 1, countX: 2, countY: 2 },
  stains: { density: 0.3, size: 50 },
}});
```

## Sheets: paper with an outline (WebGL2)

`renderSheet` renders one finite piece of paper with real alpha, for cards and other cut-out paper objects:

```ts
const r = new PaperRenderer();
const sheet = r.renderSheet(buildParams('drawing-pad'), {
  width: 250, height: 330, pixelRatio: 2,
  shape: {
    edges: { left: { kind: 'torn', amount: 3 } },      // also deckle | zigzag | cut | wavy
    holeRows: [{ x: 13, y: 11, dx: 0, dy: 22, count: 15, r: 4.6, tear: 0.3 }],
    // also: holes, radius, chamfer (tag corners), rim (pale fibrous edge on torn sides)
  },
  relief: { wrinkles: 0.1, curl: { amount: 8, corners: ['br'] }, folds: { y: 3 } },  // also crumples, cockle, bend
  finish: { opacity: 1, gloss: 0, aging: 0.3, edgeWear: 0.4 },   // also pattern (washi)
  shadow: { softness: 5, offsetX: 1.5, offsetY: 4, lift: 0.1 },
}, ['color']);       // or ['base', 'shade'] to put live text between the two, plus 'shadow' for a separate shadow layer
```

- **Edges**: torn and deckled edges get a pale, fibrous rim with stray fibres.
- **Holes**: punched holes get a slightly compressed edge, and binder-row holes can be torn out towards the edge.
- **Shadow**: cast from the alpha shape, offset further where a curled corner is lifted.
- **Ink on top**: `base` plus `shade` lets you place live HTML text on the sheet. Put the `shade` layer above it with `mix-blend-mode: hard-light`, and the text follows the folds and crumples.

## Reusable compositions

`packages/paper/src/composition` contains the shared desk/component renderers.
A versioned composition describes paper parameters, dimensions, rotation,
lighting, editable content nodes, fitting inputs, attachments, photos and motion.
The desk captures this definition before playback and renders the same definition
used by the exported component. Stable node IDs keep animation targets independent
of current playback state.

The paper uses separate base, shade and shadow canvases. Live HTML content sits
between the base and shade. Pins, clips and cords use procedural height-field
shaders. Attached photographs are graded locally, then composited with their own
paper layers. Photo grading uses consistent CPU canvas sampling to avoid different
results between first render and cached images. Date-stamp fonts load before
pixels are painted.

Pretext fits text into fixed boxes; exported data retains both fitting inputs and
the resolved content. Changing fitted text through `setCompositionText` triggers
measurement again. A component keeps its original layout and can scale the whole
composition proportionally to its container.

Brushmark drives content motion. Tegaki adds optional pen strokes. These engines
load lazily and remain outside the texture entry point. Exported motion records
the steps actually selected by the desk's animation budget and their seed.
Dragging, peeling, loose tabletop props and the desk background stay in the demo.

## Assets and lifecycle

Paper textures are generated, not sourced from images. The demo's CC0 photographs
and background scans have source records in their respective public directories.
Font files are self-hosted and recorded with hashes in `font-assets.json`.
A component ZIP contains its selected photos, fonts, optional pen data and their
licenses; desk scans never enter component ZIPs or the npm package.

Component instances own their animation and rendering resources and release them
on disposal. Font faces use reference counting. SVG filter IDs are scoped to each
instance. React initializes the browser renderer in an effect and cleans it up
when unmounted, including Strict Mode's repeated setup/cleanup cycle.

The browser tests compare every exported style's canvas pixels and text with the
desk, then extract ZIPs into separate apps, typecheck and build them against a
packed library, and render them with external asset requests blocked.

See [Library API](library.md) for supported entry points, examples and limitations.
