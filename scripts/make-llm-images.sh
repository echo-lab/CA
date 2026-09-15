#!/usr/bin/env bash
# Regenerate the downscaled page images the LLM calls use (src/Pictures/book*/llm/).
#
# The originals are ~2.3MB at 3300x2550 and are what the UI displays to children --
# do NOT resize those in place. These copies are 1024px/q80 (~135KB) and go to the
# model instead: the vision tiling produces the same ~1000 tokens either way, so the
# only thing that changes is upload time. Consumed by server/lib/pageImage.js.
#
# Run after adding or replacing any page image. Requires ImageMagick.
set -euo pipefail

cd "$(dirname "$0")/../src/Pictures"

for d in book*/; do
    d="${d%/}"
    mkdir -p "$d/llm"
    for f in "$d"/*.jpg; do
        [ -e "$f" ] || continue
        magick "$f" -resize '1024x1024>' -quality 80 "$d/llm/$(basename "$f")"
    done
    echo "$d -> $(du -sh "$d/llm" | cut -f1) ($(ls "$d/llm" | wc -l | tr -d ' ') files)"
done
