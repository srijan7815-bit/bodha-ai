# Installing BODHA on your phone

The file is **`BODHA-1.1.apk`** (version 1.1, versionCode 2) — a release-signed
build from `android/`, not a debug build and not from a store.

| | |
|---|---|
| Package | `com.bodha.ai` |
| Version | 1.1 (versionCode 2) |
| Size | 121,442 bytes (≈ 119 KB) |
| SHA-256 | `aee07baececfc03bc737cfe13fe4eedb80acaf5d50db4e3039142e155308d3dd` |
| Signer SHA-256 | `54841780b287a443faa98eb6e112dbd15a491f7a0f9ce94027034a28369d4b0f` |
| Runs on | Android 6.0 (API 23) and newer |

The signer is the same key as version 1.0, so 1.1 installs **over** 1.0 as an
update. If Android offers *Update* rather than *Install*, that is the right choice
and your data stays.

## Before installing: two switches

Android will refuse a sideloaded app until both of these are open. This is the
step that stops most installs, not the file.

1. **Allow this app to install apps.** Settings → Apps → (the app you used to
   open or download the APK: Chrome, Files, Drive, Telegram, WhatsApp —
   whichever you tap the file in) → *Install unknown apps* → **Allow**.
   On older phones: Settings → Security → *Unknown sources* → **On**.
2. **Play Protect.** Play Store → your profile picture → Play Protect → ⚙ →
   turn off *Scan apps with Play Protect* while you install, or leave it on and
   press **Install anyway** when the "Unsafe app blocked" sheet appears. Turn it
   back on afterwards. BODHA is unsigned by Google, so Play Protect cannot vouch
   for it — "unknown developer" is expected, and the blue *Install anyway* link
   is the one to press.

## Install

1. Download `BODHA-1.1.apk` to the phone. It is committed to the repository, so
   the simplest route with no laptop is the direct link, opened in the phone's
   browser:
   `https://github.com/srijan7815-bit/bodha-ai/raw/main/android/BODHA-1.1.apk`
   (the repository page → `android/` → `BODHA-1.1.apk` → *Download*).
2. Check the file: **Files / My Files** → Downloads → long-press → *Details*.
   It must be **121,442 bytes** (other file managers say "118.6 KB"). If it is
   smaller or 0 bytes, the download was cut short — download it again.
3. Tap the file → *Install* → *Install anyway* if Play Protect asks → *Open*.

## If it still says "App not installed"

Read the exact wording; each one has one cause.

| What Android says | What it means | What to do |
|---|---|---|
| *App not installed as package appears to be invalid* | The file is incomplete or was renamed | Re-download; check the size above. Some browsers save it as `.zip`/`.bin` — rename the extension back to `.apk`. |
| *Unsafe app blocked* / *Play Protect* | Google's scanner does not know this signer | Press **Install anyway**. |
| *Your phone is not allowed to install unknown apps from this source* | The switch in step 1 is off for the app you are tapping from | Turn it on for that exact app, then tap the APK again. |
| *App not installed* (no reason) | An older copy signed with a different key exists | Uninstall the old BODHA (Settings → Apps → BODHA → Uninstall), then install. |
| *There was a problem parsing the package* | The download was truncated | Re-download and check the size. |
| Nothing happens at all | A file manager is opening the APK as a zip | Use **Files** (Google) or **My Files** (Samsung) and tap it there. |

Brand notes, because these are the phones in most Indian homes:

- **Xiaomi / Redmi / POCO (MIUI, HyperOS):** Settings → Privacy protection →
  Special permissions → *Install unknown apps* → allow your file manager. If the
  MIUI scanner blocks it, tap *Scan* → *Ignore risks* → Continue. On some builds
  you must also be signed into a Mi account — Settings → Mi Account.
- **Realme / OPPO / OnePlus (ColorOS):** Settings → Password & security →
  *Install apps from unknown sources* → allow. The "Installation blocked by
  security policy" dialog has a hidden *Continue* behind *Install anyway*.
- **vivo / iQOO (Funtouch/OriginOS):** Settings → More settings → *Install apps
  from unknown sources*; then in the security prompt press *Continue install*.
- **Samsung (One UI):** Settings → Apps → Special access → *Install unknown
  apps* → enable for **My Files**.
- **Google Pixel / stock Android 14–16:** the per-app switch, then **Install
  anyway** in the Play Protect sheet. On Android 16, "Advanced Protection"
  blocks sideloading entirely while it is on — turn it off in Settings → Security
  & privacy → Advanced Protection to install, and turn it back on afterwards.

## Verifying the file is the one we built

On a phone, a checksum is awkward, so the size and the package badge are enough.
Where a computer is available:

```bash
sha256sum BODHA-1.1.apk
# aee07baececfc03bc737cfe13fe4eedb80acaf5d50db4e3039142e155308d3dd

apksigner verify --verbose --min-sdk-version 21 BODHA-1.1.apk
# Verifies · v1 scheme true · v2 scheme true · v3 scheme true · 1 signer
```

## What the app asks for, and nothing else

`INTERNET`, `ACCESS_NETWORK_STATE` (to show the offline page), `RECORD_AUDIO`
(asked for the first time you dictate), `MODIFY_AUDIO_SETTINGS`, and
`WRITE_EXTERNAL_STORAGE` which is capped at Android 9 — phones on Android 10 and
later save files through MediaStore and never see that permission. No camera, no
location, no contacts, no analytics, no ad library.
