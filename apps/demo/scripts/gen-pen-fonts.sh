#!/usr/bin/env bash
# Generate Tegaki pen-font bundles from single-line SVG fonts (Hershey / EMS) into src/desk/pen-fonts/<id>/.
# The generator isn't published on npm, so this uses a pinned checkout of the tegaki repo (needs bun), and
# python3 for fontTools: the generator draws each glyph as overlapping pen capsules, which browsers fill
# with holes where strokes cross or retrace (`r`, `f`), so the overlaps are merged into one outline.
#
#   scripts/gen-pen-fonts.sh                      # every font in FONTS below
#   scripts/gen-pen-fonts.sh hershey-sans         # just one
#
# Env: FONT_DIR   folder holding Hershey/ and EMS/ (required: directory containing licensed SVG font sources)
#      TEGAKI_DIR where to keep the generator checkout and its python venv (default: $TMPDIR/tegaki-<tag>)
# After adding a font here, register it in PEN_FONTS (src/desk/handwriting.ts).
set -euo pipefail

TAG="tegaki@1.1.0"
DESK="$(cd "$(dirname "$0")/.." && pwd)"
: "${FONT_DIR:?Set FONT_DIR to your licensed single-line SVG font directory}"
TEGAKI_DIR="${TEGAKI_DIR:-${TMPDIR:-/tmp}/tegaki-${TAG#tegaki@}}"
# printable ASCII plus the typography the cards use (content.ts) keeps each bundle small; glyphs a font lacks are skipped
CHARS=' !"#$%&'"'"'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
CHARS+='—–‘’“”·…•°¢éèáíóúñçüöäº'

# id  source svg (relative to FONT_DIR)  pen width (fraction of the em)
FONTS=(
  "hershey-script    Hershey/HersheyScript1.svg     0.06"
  "ems-allure        EMS/EMSAllure.svg              0.06"
  "hershey-sans      Hershey/HersheySans1.svg       0.06"
  "hershey-serif     Hershey/HersheySerifMed.svg    0.06"
  "ems-casual-hand   EMS/EMSCasualHand.svg          0.06"
  "ems-readability   EMS/EMSReadability.svg         0.06"
)

if [ ! -d "$TEGAKI_DIR/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/gkurt/tegaki.git "$TEGAKI_DIR"
  (cd "$TEGAKI_DIR" && bun install --ignore-scripts)
fi
VENV="$TEGAKI_DIR/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q fonttools skia-pathops
fi

for row in "${FONTS[@]}"; do
  read -r id svg pen <<<"$row"
  if [ $# -gt 0 ] && [[ ! " $* " == *" $id "* ]]; then continue; fi
  out="$DESK/src/desk/pen-fonts/$id"
  mkdir -p "$out"
  (cd "$TEGAKI_DIR" && bun start generate --stroke-font "$FONT_DIR/$svg" --pen-width "$pen" -c "$CHARS" -o "$out" >/dev/null)
  # the generator writes bundler-agnostic import attributes; Vite wants ?url for the font file
  python3 - "$out/bundle.ts" <<'PYTHON'
import re, sys
from pathlib import Path
path = Path(sys.argv[1])
source = path.read_text()
source = re.sub(r"from '(\./[^']+\.(?:otf|ttf))' with \{ type: 'url' \}", r"from '\1?url'", source)
source = source.replace("from './glyphData.json' with { type: 'json' }", "from './glyphData.json'")
path.write_text(source)
PYTHON
  for f in "$out"/*.otf; do
    "$VENV/bin/python" -I -c 'import sys; from fontTools.ttLib import TTFont; from fontTools.ttLib.removeOverlaps import removeOverlaps; f = TTFont(sys.argv[1]); removeOverlaps(f); f.save(sys.argv[1])' "$f"
  done
  echo "✓ $id  ($(du -sh "$out" | cut -f1))"
done
