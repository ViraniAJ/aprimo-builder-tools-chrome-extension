#!/bin/sh
# Builds a test zip of the extension on the Desktop, without publishing a release. The copy in the zip gets a
# display-only version_name (version, commit, date) so chrome://extensions shows which build is loaded; the real
# "version" in manifest.json only changes for releases.
set -e
cd "$(dirname "$0")/.."
npm run -s build:tools
VERSION=$(node -p "require('./extension/manifest.json').version")
COMMIT=$(git rev-parse --short HEAD)
DIRTY=$(git status --porcelain -- extension tools-src | grep -q . && echo "+changes" || true)
STAMP="$VERSION · $COMMIT$DIRTY · $(date '+%b %-d %H:%M')"
OUT=$(mktemp -d)
mkdir "$OUT/aprimo-builder-tools-extension"
rsync -a --exclude .DS_Store extension/ "$OUT/aprimo-builder-tools-extension/"
node -e '
const fs = require("fs"), p = process.argv[1];
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.version_name = process.argv[2];
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
' "$OUT/aprimo-builder-tools-extension/manifest.json" "$STAMP"
ZIP="$HOME/Desktop/aprimo-builder-tools-extension-v$VERSION.zip"
rm -f "$ZIP"
(cd "$OUT" && zip -qr "$ZIP" aprimo-builder-tools-extension)
rm -rf "$OUT"
echo "Built $ZIP ($STAMP)"
