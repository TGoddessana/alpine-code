#!/usr/bin/env bash
# Builds the signed, notarized macOS app on this Mac and ships it: the files go to the R2 bucket behind
# downloads.alpinecode.app, latest.json last (that upload is what the updater sees), then the tag is pushed.
#
#     ./scripts/release.sh 0.2.0
#
# Needs, once per Mac:
#   - the "Developer ID Application" certificate in the login keychain
#   - the updater key at ~/.tauri/alpine-updater.key (override with TAURI_SIGNING_PRIVATE_KEY), its password in the keychain:
#       security add-generic-password -a "$USER" -s alpine-code-updater-key -w
#   - the Apple ID's app-specific password in the keychain:
#       security add-generic-password -a "$APPLE_ID" -s alpine-code-notarize -w
#   - APPLE_ID in the environment, and `pnpm dlx wrangler login` done for the Cloudflare account
set -euo pipefail

version="${1:?usage: scripts/release.sh X.Y.Z}"
target=aarch64-apple-darwin
bucket="${ALPINE_RELEASE_BUCKET:-alpinecode-downloads}"
base_url="https://downloads.alpinecode.app"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "The working tree has changes; release from a clean checkout." >&2
  exit 1
fi
# The dmg step mounts a volume named AlpineCode and lays it out through Finder; an installer already mounted under
# that name makes it fail after notarizing.
if [ -d /Volumes/AlpineCode ]; then
  echo "Eject /Volumes/AlpineCode first (an Alpine Code installer is mounted)." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" > /dev/null; then
  echo "Tag v$version already exists." >&2
  exit 1
fi

# Every package carries the release's version.
python3 - "$version" <<'EOF'
import json, sys, tomllib
want = sys.argv[1]
found = {p: tomllib.load(open(p, "rb"))["project"]["version"] for p in [
    "apps/server/pyproject.toml", "packages/core/pyproject.toml", "packages/protocol/python/pyproject.toml"]}
found["apps/desktop/src-tauri/tauri.conf.json"] = json.load(open("apps/desktop/src-tauri/tauri.conf.json"))["version"]
found["apps/desktop/src-tauri/Cargo.toml"] = tomllib.load(open("apps/desktop/src-tauri/Cargo.toml", "rb"))["package"]["version"]
wrong = {p: v for p, v in found.items() if v != want}
for p, v in wrong.items():
    print(f"{p} is {v}, the release says {want}", file=sys.stderr)
sys.exit(1 if wrong else 0)
EOF

: "${APPLE_ID:?set APPLE_ID to the Apple ID that notarizes}"
export APPLE_ID
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-82VFA68TP2}"
APPLE_PASSWORD="$(security find-generic-password -a "$APPLE_ID" -s alpine-code-notarize -w)"
export APPLE_PASSWORD
APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')"
test -n "$APPLE_SIGNING_IDENTITY"
export APPLE_SIGNING_IDENTITY
export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.tauri/alpine-updater.key}"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(security find-generic-password -s alpine-code-updater-key -w)}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD

uv run python apps/desktop/scripts/bundle_runtime.py --target "$target"
pnpm install --frozen-lockfile
(cd apps/desktop && pnpm tauri build --target "$target" --config src-tauri/tauri.release.conf.json)

bundle="apps/desktop/src-tauri/target/$target/release/bundle"
dmg="$bundle/dmg/AlpineCode_${version}_aarch64.dmg"
archive="$bundle/macos/AlpineCode.app.tar.gz"
for f in "$dmg" "$archive" "$archive.sig"; do
  test -f "$f" || { echo "The build left no $f" >&2; exit 1; }
done

archive_name="AlpineCode_${version}_aarch64.app.tar.gz"
latest="$(mktemp)"
python3 - "$version" "$(cat "$archive.sig")" "$base_url/v$version/$archive_name" > "$latest" <<'EOF'
import json, sys
from datetime import datetime, timezone
version, signature, url = sys.argv[1:]
entry = {"signature": signature, "url": url}
print(json.dumps({
    "version": version,
    "notes": "",
    "pub_date": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "platforms": {"darwin-aarch64": entry, "darwin-aarch64-app": entry},
}, indent=2))
EOF

put() { # key, file, extra wrangler flags
  local key="$1" file="$2"
  shift 2
  pnpm dlx wrangler@4 r2 object put "$bucket/$key" --file "$file" --remote "$@"
}
put "v$version/AlpineCode_${version}_aarch64.dmg" "$dmg"
put "v$version/$archive_name" "$archive"
put "v$version/$archive_name.sig" "$archive.sig"
put "AlpineCode_aarch64.dmg" "$dmg" --cache-control no-cache
put "latest.json" "$latest" --content-type application/json --cache-control no-cache
rm "$latest"

git tag "v$version"
git push origin "v$version"
echo "Alpine Code $version is out: $base_url/AlpineCode_aarch64.dmg"
