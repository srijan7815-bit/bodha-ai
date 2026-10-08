# Installing BODHA on a Windows PC

The installer is **`BODHA-Setup-1.0.0.exe`**. It is published as a release asset,
because it is 103 MB — larger than anything that belongs in a git history:

```
https://github.com/srijan7815-bit/bodha-ai/releases/download/v1.0-desktop/BODHA-Setup-1.0.0.exe
```

| | |
|---|---|
| Product | BODHA · बोध — desktop 1.0.0 |
| Size | 107,302,749 bytes (103 MB) |
| SHA-256 | `82e97b798d5fffe17d23a356af6881bcb6b9c2fa2e83b5abbff173287a7212f4` |
| Requires | Windows 10 or 11, 64-bit · an internet connection |
| Install type | Per user — **no administrator prompt, no UAC** |

## Installing

1. Download `BODHA-Setup-1.0.0.exe` and open it.
2. **Windows SmartScreen** will say *"Windows protected your PC"*, because the
   installer is not signed with a paid certificate. Press **More info** →
   **Run anyway**. (A school PC's SmartScreen is often stricter: if the Run
   anyway link is missing, right-click the file → *Properties* → tick
   *Unblock* → *OK*, then open it again.)
3. Press *Next* through the wizard. Leave **Shortcuts** ticked if you want a
   Desktop icon; untick it if you only want the Start Menu entry.
4. **Open BODHA now** appears on the last page. BODHA starts in its own window.
5. Sign in with the same account you use on the phone — your chats, documents and
   library are already there, because they live on the server.

Nothing else has to be installed first: the browser engine BODHA draws with is
inside the installer. Nothing is written outside your own user account, and no
administrator rights are needed at any point.

## Checking the download (optional, needs a Command Prompt)

```bat
certutil -hashfile BODHA-Setup-1.0.0.exe SHA256
```
The long hex string must match the SHA-256 above.

## Uninstalling

Settings → Apps → *Installed apps* → **BODHA · बोध** → *Uninstall*. Nothing else
is left behind: the program folder, the two shortcuts and BODHA's own
window-size settings are all removed. Your chats and documents are on the server
and are not touched — delete the account's data from inside BODHA if you want
those gone too.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| *Windows protected your PC* | SmartScreen does not recognise the publisher | **More info** → **Run anyway**, or unblock the file in its Properties. |
| *This app can't run on your PC* | 32-bit Windows | BODHA desktop is 64-bit only. Use the web app at `bodha-ai-three.vercel.app` instead — every feature is there. |
| The installer opens, then stops with a write error | Folder permissions on a managed PC | Install for the current user only (that is the default); if your school locks even that, install it into your own Documents folder by changing the path — it needs no registry rights beyond your own hive. |
| BODHA opens on a page that says *BODHA needs the network to think* | No internet, a blocked domain, or a school filter | The page retries by itself every five seconds. BODHA's answers come from the server, so there is nothing offline to fall back to. |
| Antivirus flags the installer | NSIS installers written by unknown publishers are a common false positive | It is built from the sources in `desktop/` — you can rebuild it yourself with `desktop/build-desktop.sh`. |

## Rebuilding the installer yourself

```bash
cd desktop
./build-desktop.sh              # → BODHA-Setup-1.0.0.exe
./build-desktop.sh --smoke      # and boot the shell to check it works
```

It needs `makensis` (NSIS 3), `unzip`, `curl` and Python 3 with Pillow. The only
download is the Electron runtime from GitHub releases; it is cached in
`desktop/build/dl/`, which is not committed.
