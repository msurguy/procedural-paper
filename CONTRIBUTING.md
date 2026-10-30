# Contributing

Use Node.js 22.12+ and pnpm 10.28.1. Run `pnpm install`, then `pnpm dev`.
Before submitting a change run `pnpm typecheck`, `pnpm test`, `pnpm build`, and
`pnpm check:package`. Keep the core free of browser access at import time and of
runtime dependencies. Keep React and demo features in their separate entry points.

The demo shell mounts only one iframe document at a time. Each view publishes
its URL hash through the same-origin bridge; switching saves settings and destroys
the inactive document, stopping GPU and animation work. Back/forward
restores view settings. Dragged positions are transient; returning to Desk
regenerates the selected seed/layout. `/components.html` is the public preset gallery.
Local archives and old experiments belong in the gitignored `archive/` folder.
They are not part of the workspace, demo build, package, or release checks.

Never add private reference/source imagery. Demo images must have explicit
redistribution permission, source records and an entry in `scripts/demo-assets.json`.
Fonts and third-party materials retain their original notices. Pen bundle generation
is optional: set `FONT_DIR` to licensed single-line SVG sources before running
`apps/demo/scripts/gen-pen-fonts.sh`; generated bundles are already committed.

## Release checklist

1. Update the version and document API changes.
2. Run the checks above from a clean checkout using `pnpm install --frozen-lockfile`.
3. Run `pnpm --filter procedural-paper pack`; inspect the tarball and install it
   in a consumer project. `pnpm check:package` does the local packaging smoke checks.
4. Create/push the public GitHub repository when ready. Enable Pages with GitHub
   Actions as its source. The Pages workflow uses the repository name as the base.
5. Publish the reviewed tarball manually with npm when ready. CI never publishes npm.

The public repository starts from a fresh initial commit. Previous local Git metadata
and superseded development files are kept only in the gitignored `archive/` folder.
Do not force-add that folder, dependency caches, credentials, or build artifacts.

Run `pnpm exec playwright install chromium` and `pnpm test:browser` for browser
checks, including exact exports for every desk style and standalone ZIP consumers.
Run `pnpm audit` when preparing a release. `prepack` rebuilds the library so packing
from a clean checkout includes current JavaScript, declarations, CSS and notices.
