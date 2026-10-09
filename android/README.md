# BODHA — the Android app

The installable app is **`BODHA-1.1.apk`** (in the workspace root; `./build.sh`
writes it to `out/`). This folder is the source it is built from: one Activity,
one WebView, no third-party libraries, and no Gradle. **How to install it on a
phone, and every reason an install can be refused, is in
[`INSTALL.md`](INSTALL.md).**

## What the app is

The same BODHA the browser gets — one codebase, one place to fix a bug — wrapped
in an Android shell that behaves like a real app:

| | |
|---|---|
| **Microphone** | Dictation and Live Mode ask Android for the mic at the moment they need it; the stream is granted to the page only while it is asking. Nothing else is ever requested — no camera, no location, no contacts, no analytics. |
| **File picking** | The Library's upload button opens the phone's own file chooser, so books and PDFs come from the device. |
| **Back** | Walks BODHA's history; leaves the app only from the start page. |
| **Links** | A source link, a Gutenberg text or an archive.org scan opens in the phone's browser; BODHA's own pages stay in the app. |
| **Offline** | A plain बोध page with a retry button — not the browser's error screen. It also retries by itself when the phone rejoins a network. |
| **Pull to refresh** | Off on purpose (1.2): BODHA scrolls inside the page, so a downward swipe while reading a chat must never reload it. |
| **Saving a file** | When BODHA's computer finishes a document, the phone gets it through `BodhaNative.saveFile` and writes it straight into **Downloads** (MediaStore on Android 10+, the public folder on older phones). A download from any link — a sandbox result, a hosted file — goes through Android's own DownloadManager, so progress shows in the notification shade and nothing is buffered in the app. |
| **Paper and ink** | The status and navigation bars take the colour of the page under them, following BODHA's own Paper/Night theme rather than the phone's. The launch screen is the app's paper colour with the बोध mark, so there is no white flash. |
| **Icons** | Real adaptive icons: the बोध wordmark in Noto Serif Devanagari, rendered by `make-icons.py` at every density Android asks for. |

Permissions in the manifest: `INTERNET`, `ACCESS_NETWORK_STATE`, `RECORD_AUDIO`,
`MODIFY_AUDIO_SETTINGS`, and `WRITE_EXTERNAL_STORAGE` capped at `maxSdkVersion=28`
(Android 10 and later save through MediaStore and never see it). That is the
whole list.

## Rebuilding it

```bash
cd android
./build.sh          # → out/bodha-1.0.apk
```

The chain is the one Gradle would run, called by hand so it stays readable:
`aapt2 compile` → `aapt2 link` → `javac` → `d8` → zip → `zipalign` → `apksigner`.
It needs an SDK at `$ANDROID_SDK` (default `/home/user/android`: build-tools r34
and the API 34 platform) and a JDK.

After changing Java, signing is automatic. After changing **`res/`**, regenerate
the icons first:

```bash
python3 make-icons.py    # needs Pillow with Raqm for correct बोध shaping
./build.sh
```

## The keystore — keep it

`keystore/bodha-release.jks` (alias `bodha`, password in `build.sh`) is the
identity of this app. **An update must be signed with the same key**, or Android
refuses to install it over the old one and the student has to uninstall first.
It is committed here on purpose: this workspace and the repository are the only
places the project lives.

## Where the work happens

BODHA is split on purpose, and the split is the reason the app is this small:

| On the server (heavy) | On the phone (light) |
|---|---|
| The model chain (Kimi K2.6 → GLM 5.3 Flash → Nemotron → GPT-OSS), retrieval over the IKS corpus, OCR, web search, the code sandbox, and every document BODHA builds — PDF, Word, Excel | The window, the shell, the microphone, the file picker, the screen, and moving finished bytes into Downloads |

The WebView is the browser BODHA is already tested in; the wrapper adds only what
a browser cannot do — a microphone that survives the page, a real file chooser,
back that behaves, an offline page instead of a dinosaur, and a Downloads folder
that works.

## Version

`versionCode 2`, `versionName 1.1`. For an update, change both in
`AndroidManifest.xml` (and the `--version-code`/`--version-name` flags in
`build.sh`), rebuild, and install the new APK over the old one — **the same
keystore every time**.
