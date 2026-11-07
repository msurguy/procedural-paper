# procedural-paper

Seamless procedural paper textures and paper UI components. A personal open-source
project by [Maks Surguy](https://github.com/msurguy), licensed under MIT.

[Demo](https://msurguy.github.io/procedural-paper/) · [Library API](docs/library.md) · [Technical notes](docs/technical.md)

Generate color, albedo, overlay, height and normal maps from code, without source
texture images. Use 25 paper component presets — notes, notebook pages, tags,
receipts, photo frames and more — with live HTML or React content.

The demo has two tabs: **Exporter** for making textures, and **Desk** for seeing
paper components in use. Select a desk card to preview and export its exact React
or Vanilla component, with editable content, photos, fonts, attachments and
content animations. Download a ZIP for a standalone example, or copy low-level
sheet code. Desk physics and loose tabletop props remain demo features.

## Run locally

Requires Node.js 22.12+ and pnpm 10.28.1.

```sh
corepack enable
pnpm install
pnpm dev
```

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm check:package
pnpm preview
```

## Use the library

```sh
npm install procedural-paper
```

```ts
import { generatePaper, toBlob } from 'procedural-paper';

const paper = await generatePaper({ preset: 'kraft', width: 1024, seed: 7 });
const url = URL.createObjectURL(await toBlob(paper.maps.color!));
document.body.style.backgroundImage = `url(${url})`;
// Revoke the URL when the background is no longer needed.
```

```ts
import { createPaperCard } from 'procedural-paper/dom';
import 'procedural-paper/styles.css';

const note = createPaperCard({ preset: 'sticky', seed: 7 });
note.slots.content.textContent = 'Make something with paper.';
document.body.append(note.element);
// Later: note.update({ seed: 8 }); or note.dispose();
```

```tsx
import { PaperCard } from 'procedural-paper/react';
import 'procedural-paper/styles.css';

export function Note() {
  return <PaperCard preset="sticky">Make something with paper.</PaperCard>;
}
```

The core has no runtime dependencies. React is an optional peer. Texture maps
support WebGL2 and a CPU backend; shaped components need WebGL2 and show readable,
plain paper when it is unavailable. Imports are SSR-safe.

## Repository

- `packages/paper`: renderer, presets, DOM and React entry points.
- `apps/demo`: one Vite demo, with isolated Exporter and Desk views.
- `docs`: public API and rendering details.

The demo contains attributed CC0 photos and desk scans. They are sample content,
not inputs to procedural paper generation, and are excluded from the npm package.
Private/reference original images are excluded. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Publishing

CI validates the library and demo. The Pages workflow deploys the built demo on
pushes to the default branch or manual dispatch; enable **GitHub Actions** as the
Pages source in repository settings. It derives the base path from the repository name.
No npm publishing happens automatically. See [release instructions](CONTRIBUTING.md).
