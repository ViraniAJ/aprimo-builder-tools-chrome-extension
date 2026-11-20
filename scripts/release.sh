#!/bin/sh
# Publishes the current commit as a GitHub release with a zip of extension/ (for "Load unpacked").
#   npm run release -- "What changed, in a sentence or two"
# The version comes from extension/manifest.json; bump it, commit and push first. Needs gh signed in.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./extension/manifest.json').version")
TAG="v$VERSION"
NOTES=${1:-"See the commit history for what changed."}
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first."; exit 1; }
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Push main first (git push)."; exit 1; }
if gh release view "$TAG" >/dev/null 2>&1; then echo "Release $TAG already exists: bump the version in extension/manifest.json."; exit 1; fi
OUT=$(mktemp -d)
mkdir "$OUT/aprimo-builder-tools-extension"
git archive HEAD extension | tar -x -C "$OUT/aprimo-builder-tools-extension" --strip-components=1
(cd "$OUT" && zip -qr "aprimo-builder-tools-extension-$TAG.zip" aprimo-builder-tools-extension)
gh release create "$TAG" "$OUT/aprimo-builder-tools-extension-$TAG.zip" --title "Aprimo Builder Tools $TAG" --notes "$NOTES

Community-built and maintained tools, not core Aprimo functionality. Use at your own risk.

**Install or update:** download \`aprimo-builder-tools-extension-$TAG.zip\`, unzip it, and in \`chrome://extensions\` (Developer mode) click **Load unpacked** and pick the unzipped folder, or replace the folder you loaded before and click the reload icon. Then refresh your Aprimo tabs."
rm -rf "$OUT"
