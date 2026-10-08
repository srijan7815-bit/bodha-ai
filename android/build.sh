#!/usr/bin/env bash
#
# Builds BODHA's Android app — a signed, installable APK, with no Gradle and no
# Android Studio, because neither is needed for an app with one Activity.
#
#   ./build.sh
#
# The chain is the same one Gradle would run, just called by hand so it is
# readable and repeatable:
#
#   aapt2 compile   res/                     → compiled resources
#   aapt2 link      + manifest + android.jar → APK skeleton with resources.arsc
#   javac           java/                    → .class files against android.jar
#   d8              .class files             → classes.dex
#   (zip)           classes.dex + assets/    → into the APK skeleton
#   zipalign        → uncompressed, page-aligned entries
#   apksigner        → signed with the keystore below
#
# The keystore is generated on the first run and reused afterwards. Keep it: an
# update to BODHA must be signed with the same key or Android will refuse to
# install it over the old one.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK:-/home/user/android}"
BT="$SDK/bt/android-14"
PLATFORM="$SDK/pf/android-34/android.jar"

APP_NAME="bodha"
VERSION="1.0"
BUILD_DIR="$HERE/build"
OUT_DIR="$HERE/out"
KEYSTORE="$HERE/keystore/bodha-release.jks"
KEY_ALIAS="bodha"
KEY_PASS="${BODHA_KEYSTORE_PASSWORD:-bodha-release-key}"

say() { printf '\033[1;36m%s\033[0m\n' "$1"; }
die() { printf '\033[1;31m%s\033[0m\n' "$1" >&2; exit 1; }

[ -x "$BT/aapt2" ] || die "aapt2 not found in $BT — set ANDROID_SDK to the SDK root."
[ -f "$PLATFORM" ] || die "android.jar not found at $PLATFORM"
command -v javac >/dev/null || die "javac not found — a JDK is required."
# keytool ships with the JDK but is not always on PATH.
KEYTOOL="$(command -v keytool || true)"
[ -n "$KEYTOOL" ] || KEYTOOL="$(dirname "$(readlink -f "$(command -v javac)")")/keytool"
[ -x "$KEYTOOL" ] || die "keytool not found — the JDK's bin directory must contain it."

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"/{compiled,classes,dex} "$OUT_DIR"

# ── 1. resources ──────────────────────────────────────────────────────────────
say "▸ compiling resources"
# One zip of compiled resources; --dir does the walking, so no file list.
"$BT/aapt2" compile --dir "$HERE/res" -o "$BUILD_DIR/compiled.zip"

# ── 2. link into an APK skeleton ──────────────────────────────────────────────
say "▸ linking resources and manifest"
"$BT/aapt2" link \
  -o "$BUILD_DIR/base.apk" \
  -I "$PLATFORM" \
  --manifest "$HERE/AndroidManifest.xml" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code 1 \
  --version-name "$VERSION" \
  --java "$BUILD_DIR/gen" \
  -A "$HERE/assets" \
  "$BUILD_DIR/compiled.zip"

# ── 3. Java → bytecode ────────────────────────────────────────────────────────
say "▸ compiling Java"
find "$HERE/java" -name '*.java' > "$BUILD_DIR/sources.txt"
javac -nowarn -encoding UTF-8 -source 11 -target 11 \
  -classpath "$PLATFORM" \
  -d "$BUILD_DIR/classes" \
  @"$BUILD_DIR/sources.txt" 

# A compile that produced nothing is a failure, not a quiet success.
[ -n "$(find "$BUILD_DIR/classes" -name '*.class' -print -quit)" ] || die "javac produced no classes"

# ── 4. bytecode → dex ─────────────────────────────────────────────────────────
say "▸ dexing"
"$BT/d8" \
  --lib "$PLATFORM" \
  --min-api 24 \
  --output "$BUILD_DIR/dex" \
  $(find "$BUILD_DIR/classes" -name '*.class')

# ── 5. put the dex and assets into the APK ────────────────────────────────────
say "▸ assembling"
UNSIGNED="$BUILD_DIR/$APP_NAME-unsigned.apk"
cp "$BUILD_DIR/base.apk" "$UNSIGNED"
( cd "$BUILD_DIR" && zip -q -j "$UNSIGNED" dex/classes.dex )
# assets were included by aapt2 -A; confirm rather than assume
unzip -l "$UNSIGNED" | grep -q 'assets/offline.html' || die "assets/offline.html missing from the APK"

# ── 6. align ──────────────────────────────────────────────────────────────────
ALIGNED="$BUILD_DIR/$APP_NAME-aligned.apk"
"$BT/zipalign" -f -p 4 "$UNSIGNED" "$ALIGNED"

# ── 7. sign ───────────────────────────────────────────────────────────────────
if [ ! -f "$KEYSTORE" ]; then
  say "▸ creating a release keystore (keep this file — updates must use it)"
  mkdir -p "$(dirname "$KEYSTORE")"
  "$KEYTOOL" -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10950 \
    -storepass "$KEY_PASS" -keypass "$KEY_PASS" \
    -dname "CN=BODHA AI, OU=BODHA, O=BODHA AI, L=Lucknow, ST=Uttar Pradesh, C=IN" >/dev/null 2>&1 \
    || die "keytool failed to create a keystore"
fi

say "▸ signing"
FINAL="$OUT_DIR/bodha-$VERSION.apk"
"$BT/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$KEY_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$FINAL" \
  "$ALIGNED"

# ── 8. prove it ───────────────────────────────────────────────────────────────
say "▸ verifying"
"$BT/apksigner" verify --print-certs "$FINAL" | head -6
"$BT/aapt2" dump badging "$FINAL" | grep -E "^package|^application-label|^launchable-activity|uses-permission|sdkVersion|targetSdkVersion" || true

SIZE=$(du -h "$FINAL" | cut -f1)
printf '\n\033[1;32m✓ %s (%s)\033[0m\n' "$FINAL" "$SIZE"
