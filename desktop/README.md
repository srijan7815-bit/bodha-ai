# BODHA — the Windows app

**`BODHA-Setup-1.0.0.exe`** — a per-user Windows installer, published as a release
asset because it is 103 MB. How to install it, what SmartScreen will say, and what
to do if a school PC refuses, is in [`INSTALL.md`](INSTALL.md).

This folder is the source it is built from: one main file, one preload file, one
offline page, and a build script. No bundler, no framework, no dependency.

## What the app is

The same BODHA the browser and the phone get — one product, one source of truth,
one place to fix a bug — in a real Windows window:

| | |
|---|---|
| **Its own window** | BODHA's paper colour as the background, its own icon (बोध, drawn by `make-icons.py`), remembered size and position, maximised state restored, and a sensible minimum width so the phone layout can be used on a narrow window. |
| **A Windows menu** | BODHA (About, open in the default browser), Edit, Go (chat, library, BODHA's computer, settings — Ctrl+1…3), View (reload, zoom, full screen), Window, Help. Keyboard shortcuts behave the way Windows users expect, including copy and paste in the composer. |
| **Links** | A source, a Gutenberg text or an archive.org scan opens in the user's own browser. BODHA's own pages stay in the app. |
| **The microphone** | Dictation and Live Mode ask once, and only for audio; every other permission request is refused by the shell. |
| **Downloads** | A finished document — PDF, Word, Excel — goes through Windows' own download flow and lands in Downloads with a sane filename. |
| **Offline** | A page of BODHA's own, in BODHA's own type: paper, ink, बोध, and a retry. While it is up, the shell itself checks every five seconds and returns to BODHA the moment the server answers — no flashing, no hammering. |
| **One instance** | Launching BODHA again raises the window that is already open instead of starting a second copy. |

## Where the work happens

The split is the same as on the phone, and it is the reason this app is a shell
rather than a program:

| On the server (heavy) | On the PC (light) |
|---|---|
| The model chain (Kimi K2.6 → GLM 5.3 Flash → Nemotron 3 Super → GPT-OSS 20B), retrieval over the 6,525-passage Indian Knowledge Systems corpus, OCR, web search, the code sandbox, and every document BODHA builds | The window, the menu, the microphone, the file picker, the screen, and putting a finished file into Downloads |

## The files

```
desktop/
├── app/
│   ├── main.js          the whole shell: window, menu, navigation, permissions,
│   │                    downloads, offline handling, one file end to end
│   ├── preload.js       two verbs only: retry, and open a link externally
│   └── offline.html     BODHA's offline page, local, so it always loads
├── fonts/               Noto Serif Devanagari, for बोध in the offline page
├── icons/               बोध as PNGs and as a multi-size .ico (generated)
├── make-icons.py        draws those icons with real Devanagari shaping
├── installer.nsi        the NSIS script: per-user install, shortcuts, uninstaller
└── build-desktop.sh     fetch runtime → trim → rename → stage → makensis
```

## Rebuilding

```bash
./build-desktop.sh              # → ../BODHA-Setup-1.0.0.exe
ELECTRON_VERSION=44.7.0 ./build-desktop.sh
./build-desktop.sh --smoke      # also boots the shell here, under xvfb
```

The script fetches the Electron runtime once into `build/dl/` (not committed),
keeps only the English locale pack, renames `electron.exe` to `BODHA.exe`, copies
this folder's app files into `resources/app/`, and packs the result with
`makensis`. LZMA over ~320 MB takes about three minutes.

## What was verified

- The shell boots and loads the live app — the same `main.js` that ships, run
  under `xvfb` on this machine (`--smoke`, or `BODHA_LOG=1` by hand).
- Pointed at a host that refuses connections, it shows the offline page, and then
  returns to BODHA by itself when the host comes back (checked end to end
  against a local server started and stopped underneath it).
- The payload is complete and self-contained: 28 files, `BODHA.exe`,
  `resources/app/` with the shell, no missing runtime piece.
- The installer is a standard NSIS per-user package; its uninstaller removes the
  program folder, both shortcuts, the Apps entry and the local window state.

## The Windows build was not run on Windows here

This project is built from a Linux machine with no Windows and no laptop. What
that means honestly: the installer and the shell are built and checked as far as
this machine allows, and the Windows-specific part is Electron's own Windows
runtime (unchanged, from GitHub releases) plus a 40-line NSIS script. If anything
on the PC does refuse it, `INSTALL.md` says which message means what.
