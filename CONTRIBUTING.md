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

## Releasing

Note user-facing changes under `## Unreleased` in `CHANGELOG.md` as you go. Then,
on an up-to-date `main`:

```sh
pnpm release patch          # or minor, major, or an exact version like 0.2.0
pnpm release patch --push   # same, and also push the branch and open the PR (needs gh)
```

The script bumps `packages/paper/package.json`, moves the Unreleased notes under
the new version, runs typecheck, tests, build and `check:package`, and commits
`Release vX.Y.Z` on a `release-vX.Y.Z` branch. Merge that PR. The **Publish to npm**
workflow then publishes the version from `main` with provenance, tags `vX.Y.Z`,
and creates a GitHub release from the changelog entry. It skips versions already
on npm, so re-running it is safe. Don't run `npm publish` locally.

The workflow authenticates with npm trusted publishing. One-time setup: on
npmjs.com, open procedural-paper → Settings → Trusted Publisher, choose GitHub
Actions, and enter user `msurguy`, repository `procedural-paper`, workflow
`publish.yml`. An `NPM_TOKEN` repository secret also works.

To inspect a tarball by hand, run `pnpm --filter procedural-paper pack` and install
it in a consumer project. Run `pnpm audit` before larger releases. The Pages
workflow deploys the demo from `main`, using the repository name as the base path.

The public repository starts from a fresh initial commit. Previous local Git metadata
and superseded development files are kept only in the gitignored `archive/` folder.
Do not force-add that folder, dependency caches, credentials, or build artifacts.

Run `pnpm exec playwright install chromium` and `pnpm test:browser` for browser
checks, including exact exports for every desk style and standalone ZIP consumers.
Run `pnpm audit` when preparing a release. `prepack` rebuilds the library so packing
from a clean checkout includes current JavaScript, declarations, CSS and notices.
