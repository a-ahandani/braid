#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
{
  echo "# Third-party notices"
  echo
  echo "This application statically links the Rust crates below. Each is used under the license its authors chose; the full license texts ship with the crate sources on crates.io."
  echo
  echo "## Fonts (bundled by egui)"
  echo
  echo "- Ubuntu Light: Ubuntu Font License 1.0, Canonical Ltd."
  echo "- Hack: MIT License, Source Foundry Authors, with Bitstream Vera glyphs under the Bitstream Vera License"
  echo "- Noto Emoji: SIL Open Font License 1.1, Google"
  echo "- emoji-icon-font: MIT License, John Slegers"
  echo
  echo "## Native library"
  echo
  echo "- libgit2: GNU GPL v2 with linking exception, the libgit2 contributors"
  echo
  echo "## Crates"
  echo
  cargo metadata --format-version 1 | python3 -c '
import json, sys
m = json.load(sys.stdin)
seen = set()
for p in sorted(m["packages"], key=lambda p: p["name"]):
    if p["name"] == m["packages"][0]["name"] and p["source"] is None:
        continue
    if p["source"] is None:
        continue
    key = (p["name"], p["version"])
    if key in seen:
        continue
    seen.add(key)
    print("- %s %s: %s" % (p["name"], p["version"], p.get("license") or "see repository"))
'
} > THIRD-PARTY-NOTICES.md
echo "Wrote THIRD-PARTY-NOTICES.md"
