#!/bin/bash
# usage: kit/install.sh <motifcode checkout>
# Adds the alpine harness to Motifcode's polyglot-bench kit: applies motifcode-kit.patch (harness lists, pytest
# venv on PATH, provider connection errors classified as transport) and copies the adapter.
set -e
KIT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${1:?usage: install.sh <motifcode checkout>}" && pwd)"
if git -C "$REPO" apply --check "$KIT/motifcode-kit.patch" 2>/dev/null; then
  git -C "$REPO" apply "$KIT/motifcode-kit.patch"
  echo "applied motifcode-kit.patch"
else
  echo "motifcode-kit.patch already applied or does not apply; leaving the kit as is"
fi
cp "$KIT/alpine.sh" "$REPO/packages/eval/polyglot-bench/adapters/alpine.sh"
chmod +x "$REPO/packages/eval/polyglot-bench/adapters/alpine.sh"
echo "installed adapters/alpine.sh"
