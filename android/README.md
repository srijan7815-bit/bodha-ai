# BODHA — the Android app

The installable app is **`BODHA-1.0.apk`** (in the workspace root, and rebuilt
into `../bodha-app/out/`). This folder is the source it is built from: one
Activity, one WebView, no third-party libraries, and no Gradle.

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
| **Pull to refresh** | Drag down at the top of a page. |
| **Paper and ink** | The status and navigation bars take the colour of the page under them, following BODHA's own Paper/Night theme rather than the phone's. The launch screen is the app's paper colour with the बोध mark, so there is no white flash. |
| **Icons** | Real adaptive icons: the बोध wordmark in Noto Serif Devanagari, rendered by `make-icons.py` at every density Android asks for. |

Permissions in the manifest: `INTERNET`, `ACCESS_NETWORK_STATE`, `RECORD_AUDIO`,
`MODIFY_AUDIO_SETTINGS`. That is the whole list.

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

## Version

`versionCode 1`, `versionName 1.0`. For an update, change both in
`AndroidManifest.xml` (and the `--version-code`/`--version-name` flags in
`build.sh`), rebuild, and install the new APK over the old one.
