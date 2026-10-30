# Third-party notices

Original project code is MIT © 2026 Maks Surguy. Third-party materials retain
their own licenses; the MIT license does not replace those terms.

## Paper Shaders

The paper overlay algorithms acknowledge the paper-texture shader in
[Paper Shaders](https://github.com/paper-design/shaders), by Paper Design,
licensed under Apache-2.0. This project's implementation reworks the overlays
for periodic tiling and matching CPU/GPU rendering. Attribution appears in
`src/params.ts` and `src/cpu/overlays.ts` in the library source. The upstream
license is included in `licenses/Apache-2.0.txt` in both repository and package.

## Demo-only materials (not included in the npm library)

- Desk scan derivatives: Poly Haven CC0. Full author, source and modification
  records: `apps/demo/public/textures/README.md`.
- Sample photo derivatives: StockSnap CC0, found through Openverse. Full author
  and source records: `apps/demo/public/photos/README.md`.
- Hershey stroke font data: acknowledgements and redistribution conditions in
  each `apps/demo/src/desk/pen-fonts/hershey-*/LICENSE.txt`.
- EMS fonts: Sheldon B. Michaels; SVG conversion by Windell H. Oskay. Derived
  from Allura (Rob Leuschke), Covered By Your Grace (Kimberly Geswein), and
  Source Sans (Paul D. Hunt / Adobe). Attribution and full OFL text accompany
  each font under `apps/demo/src/desk/pen-fonts/ems-*`. Tegaki generates pen
  outlines and the generation script merges overlapping strokes.
- Self-hosted Google Fonts retain their upstream licenses. The npm library
  does not bundle font binaries; composition consumers supply their own asset URLs.
- Brushmark, Tegaki and Pretext are demo dependencies and optional library
  composition peers. The texture core has no runtime dependencies.
  Their upstream licenses remain with their distributions. A demo build copies
  available package license files and bundled font notices into `licenses/`.

Only the documented CC0 derivatives belong in the demo's image directories.
Private scans, reference photographs, and original source collections must not
be committed. The release check enforces the current image allowlist.

## Desk example exports

The demo self-hosts its Google Fonts faces in `apps/demo/public/fonts`, with
per-family license files. `apps/demo/src/desk/font-assets.json` records their
upstream URLs and SHA-256 hashes. `apps/demo/scripts/vendor-fonts.mjs` refreshes
this manifest deliberately; it is not part of normal builds. Component ZIPs copy
only the selected assets and their license/credit files. The npm library does
not bundle these font binaries or demo photos.

Optional composition peers: @chenglou/pretext (text layout), brushmark (content
motion), and tegaki (pen strokes). Existing pen font license files accompany
exports containing those fonts. Generated example code is MIT; the included
media and font licenses retain their own terms.
