#!/usr/bin/env bash
#
# BODHA for Windows — the build.
#
# No bundler, no electron-builder, no wine: the Electron runtime is fetched once,
# trimmed, given BODHA's own name and app folder, and packed into an installer by
# makensis. Every step is visible, and the same script runs on any Linux box.
#
#   ./build-desktop.sh              # → BODHA-Setup-1.0.exe
#   ELECTRON_VERSION=44.7.0 ./build-desktop.sh
#   ./build-desktop.sh --smoke      # also boots the shell on this machine (needs xvfb)
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
DL="$BUILD/dl"
PAYLOAD="$BUILD/payload"
VERSION="1.0.0"
ELECTRON_VERSION="${ELECTRON_VERSION:-44.7.0}"
OUT="${OUT:-$(cd "$HERE/../.." && pwd)/BODHA-Setup-${VERSION}.exe}"

say() { printf '\033[1;36m▸\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

command -v makensis >/dev/null || die "makensis is not installed (apt-get install -y nsis)"
mkdir -p "$DL"

# ── 1. the runtime ────────────────────────────────────────────────────────────
ZIP="$DL/electron-v${ELECTRON_VERSION}-win32-x64.zip"
if [ ! -f "$ZIP" ]; then
  say "fetching Electron $ELECTRON_VERSION for Windows (x64)"
  curl -fSL --retry 3 -o "$ZIP.part" \
    "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-win32-x64.zip"
  mv "$ZIP.part" "$ZIP"
fi

say "unpacking the runtime"
rm -rf "$PAYLOAD"
mkdir -p "$PAYLOAD"
unzip -q -o "$ZIP" -d "$PAYLOAD"

# Only the English strings of the runtime's own UI are needed; BODHA's pages
# bring their own text, in whichever language the reader chose.
if [ -d "$PAYLOAD/locales" ]; then
  find "$PAYLOAD/locales" -type f ! -name 'en-US.pak' -delete
fi
rm -f "$PAYLOAD/resources/default_app.asar"

# The program the shortcut points at is called BODHA.exe, not electron.exe.
mv "$PAYLOAD/electron.exe" "$PAYLOAD/BODHA.exe"
[ -f "$PAYLOAD/BODHA.exe" ] || die "the runtime did not contain electron.exe"

# ── 2. BODHA itself ───────────────────────────────────────────────────────────
say "staging the app"
APP="$PAYLOAD/resources/app"
mkdir -p "$APP"
cp "$HERE/app/main.js" "$HERE/app/preload.js" "$HERE/app/offline.html" "$APP/"
cp -r "$HERE/icons" "$APP/icons"
cp -r "$HERE/fonts" "$APP/fonts"
python3 - "$HERE/package.json" "$APP/package.json" <<'PY'
import json, sys
pkg = json.load(open(sys.argv[1]))
pkg['main'] = 'main.js'   # inside resources/app the shell is the root
json.dump(pkg, open(sys.argv[2], 'w'), indent=2)
PY

say "icons"
python3 "$HERE/make-icons.py" >/dev/null

# ── 3. the installer ──────────────────────────────────────────────────────────
[ -f "$HERE/icons/bodha.ico" ] || die "icons/bodha.ico is missing (run make-icons.py)"
say "packing the installer (this is the slow part — LZMA over ~300 MB)"
(cd "$HERE" && makensis -V2 -DPAYLOAD="$PAYLOAD" -DOUTFILE="$OUT" installer.nsi)

# ── 4. what was produced ──────────────────────────────────────────────────────
[ -f "$OUT" ] || die "the installer was not written to $OUT"
say "✓ $OUT ($(du -h "$OUT" | cut -f1))"
echo "  sha256  $(sha256sum "$OUT" | cut -d' ' -f1)"
echo "  payload $(du -sh "$PAYLOAD" | cut -f1) → $(find "$PAYLOAD" -type f | wc -l) files"

# ── 5. optional: does the shell actually boot? ────────────────────────────────
if [ "${1:-}" = "--smoke" ]; then
  command -v xvfb-run >/dev/null || die "xvfb-run is needed for --smoke (apt-get install -y xvfb)"
  LZIP="$DL/electron-v${ELECTRON_VERSION}-linux-x64.zip"
  if [ ! -f "$LZIP" ]; then
    say "fetching the Linux runtime, to boot the same main.js here"
    curl -fSL --retry 3 -o "$LZIP.part" \
      "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-x64.zip"
    mv "$LZIP.part" "$LZIP"
  fi
  SMOKE="$BUILD/smoke"
  rm -rf "$SMOKE"; mkdir -p "$SMOKE"
  unzip -q -o "$LZIP" -d "$SMOKE"
  cp -r "$PAYLOAD/resources/app" "$SMOKE/resources/app"
  chmod +x "$SMOKE/electron"
  say "booting the shell under xvfb"
  set +e
  BODHA_LOG=1 BODHA_SMOKE_EXIT=1 timeout 90 xvfb-run -a "$SMOKE/electron" "$SMOKE/resources/app" \
    --no-sandbox > "$BUILD/smoke.log" 2>&1 &
  SMOKE_PID=$!
  for i in $(seq 1 40); do
    sleep 1
    grep -q "loaded https" "$BUILD/smoke.log" && break
    kill -0 $SMOKE_PID 2>/dev/null || break
  done
  kill $SMOKE_PID 2>/dev/null
  wait $SMOKE_PID 2>/dev/null
  set -e
  tail -20 "$BUILD/smoke.log"
  echo "  full log: $BUILD/smoke.log"
fi
