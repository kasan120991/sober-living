#!/usr/bin/env bash
# Add a shadcn-vue component without the two side effects that made adding one
# expensive enough that people hand-rolled instead (CLAUDE.md, UI rules gotcha 1).
#
#   1. `shadcn-vue add` rewrites app/assets/css/main.css on EVERY add — plain or
#      not — restoring the Google Fonts CDN @imports the preset ships and this
#      project forbids (a third-party request on every page load). We snapshot
#      the file and restore it afterwards.
#   2. It prompts per existing file to overwrite. Our vendored button, input,
#      select and sidebar carry the conditional 44px tap floor; overwriting one
#      silently drops it. We answer "n" to every such prompt.
#
# Usage: npm run ui:add -- @shadcn/table @shadcn/card
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -eq 0 ]; then
  echo "usage: npm run ui:add -- @shadcn/<item> [@shadcn/<item>...]" >&2
  exit 1
fi

CSS=app/assets/css/main.css
SNAPSHOT=$(mktemp)
cp "$CSS" "$SNAPSHOT"
trap 'rm -f "$SNAPSHOT"' EXIT

yes n | npx shadcn-vue@latest add "$@" --yes || true

if ! cmp -s "$CSS" "$SNAPSHOT"; then
  cp "$SNAPSHOT" "$CSS"
  echo "→ restored $CSS (the CLI rewrote it; see the note above)"
fi

echo "→ done. Review new components for the 44px tap floor before committing:"
echo "  max-md:h-11 pointer-coarse:h-11 on anything a tech taps in a hallway."
