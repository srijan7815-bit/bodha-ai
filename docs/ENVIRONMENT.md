# Environment variables

BODHA reads its keys from environment variables. On Vercel they live in the project settings, **not** in the repository.
The full list (with what each one does) is in [`env.manifest.json`](../env.manifest.json) and [`.env.example`](../.env.example).

## What you actually need

| Variable | Why |
|---|---|
| `NVIDIA_API_KEY` | Answers and OCR (NVIDIA NIM) |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Accounts, chats, uploaded books (Firestore) |
| `FISH_AUDIO_API_KEY` | Read-aloud and Live Mode voice |
| `GROQ_API_KEY` | Dictation and Live Mode listening |
| `TAVILY_API_KEY` *(recommended)* | Web search, first engine (falls back to the keyless search without it) |
| `TINYFISH_API_KEY` *(recommended)* | Web search, second engine — takes over when Tavily has no key or is out of credit |
| `E2B_API_KEY` *(recommended)* | BODHA's Computer can run Python and shell commands |

The newer layers (all optional — the app is unchanged without them):

| Variable | Why |
|---|---|
| `AGENTA_API_KEY` | Deep web research through the Agenta research agent. `AGENTA_HOST`, `AGENTA_PROJECT_ID`, `AGENTA_AGENT_SLUG` are discovered automatically when left empty |
| `OPENVIKING_URL` / `OPENVIKING_API_KEY` | Long-term memory about the student (OpenViking, `github.com/volcengine/OpenViking`) |

See **[INTEGRATIONS.md](INTEGRATIONS.md)** for how each one works, when it runs, and what
happens when it is missing.

Everything else has a default in the code. Recommended extras: `GITHUB_TOKEN` (read-only, public repos) and `GITHUB_DEFAULT_OWNER`.
The old `.env` also held `NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / MESSAGING_SENDER_ID / APP_ID` — the code does not read these, so they need not be copied.
Check all of the above at once with `node scripts/check-integrations.mjs`.

## Before the exhibition: the `.env` in this repository is public

This repository is **public**, and `.env` is **tracked**, so it is served at
`https://raw.githubusercontent.com/srijan7815-bit/bodha-ai/main/.env` and appears in at
least five commits. The steps below are good practice; right now they are urgent —
rotate the keys *and* scrub the history. The exact procedure, and what was verified
about it, is in [INTEGRATIONS.md §6](INTEGRATIONS.md#6-security--do-this-before-the-exhibition).

## Moving to Vercel safely (do these in order)

1. **Add the variables to Vercel.** Easiest: Vercel dashboard → *Settings → Environment Variables → Import .env* (paste or upload your local `.env`).
   Or from a terminal: `npm i -g vercel && vercel login && vercel link`, then `node scripts/push-env-to-vercel.mjs --dry` to preview and `node scripts/push-env-to-vercel.mjs` to send.
   Tick **Production** and **Preview**. For `FIREBASE_ADMIN_PRIVATE_KEY` paste the whole key; real line breaks or `\n` both work.
2. **Redeploy** (Deployments → ⋯ → Redeploy, or push a commit). Variables are read when a deployment is built.
3. **Verify before deleting anything.** Sign in, then open `/api/health`. You want `"env": { "ok": true }` and `"store": "firebase"`.
   Settings → *System health* → *Check now* should show Storage as "Firestore is reading and writing normally".
   (If Firebase variables are missing on Vercel the app silently falls back to a temporary file store and forgets chats — this is exactly what the check catches.)
4. **Only then stop tracking the file:**
   ```bash
   git rm --cached .env
   git commit -m "Stop tracking .env — variables now live in Vercel"
   git push
   ```
   `.gitignore` already ignores `.env`, so it stays on your machine for local work (copy `.env.example` to start a new one).
5. **Rotate the keys.** `.env` has been in the git history, so anyone who ever had read access to the repository could have seen it.
   Generate new values for the NVIDIA, Fish Audio, Groq and Firebase service-account keys, put the new ones in Vercel, and revoke the old ones.
   (Removing the file does not remove it from history; rotating is what makes the old values worthless.)

## Checking locally

```bash
npm run check:env                          # what the current environment provides
node scripts/check-env.mjs --file .env     # what a local file provides
```
`npm run build` runs the same check first and only warns — it never blocks a deploy.

## Not covered here

`android/keystore/bodha-release.jks` (the APK signing key) is also tracked, and `android/build.sh` has a default password. Keep it private, and do not rotate it unless you are happy for users to reinstall the app: Android only updates an app signed with the same key.
