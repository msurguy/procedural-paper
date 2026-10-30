# Desk surface scans

These 2048 × 2048 textures are locally bundled derivatives of Poly Haven's
CC0 assets: https://polyhaven.com/license

| File | Original |
| --- | --- |
| oak.webp | https://polyhaven.com/a/oak_veneer_01 |
| walnut.webp | https://polyhaven.com/a/american_walnut_veneer |
| plywood.webp | https://polyhaven.com/a/plywood |
| concrete.webp | https://polyhaven.com/a/concrete |

Source: each asset's 2K JPEG diffuse map, downloaded October 12, 2026.
Oak was rotated 90° clockwise to run the grain across the desk. Walnut retains
its original orientation and has a warm stain grade (RGB multipliers 1.07, 0.79,
0.60) applied to the diffuse map.
All four were encoded to WebP at quality 88, preserving the full 2K resolution.
No external image service or API is called at runtime. Assets load on demand.

Original authors: Jenelle van Heerden (oak and walnut); Rob Tuytel (plywood and concrete).

The surface scale is specified in `src/surfaces.ts` independently of the paper
grain control. Failed image loads fall back to the existing procedural material.
