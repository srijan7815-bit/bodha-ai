# Integrations — cloud storage, chat workspace, Agenta, TinyFish, OpenViking

This document is the reference for the five things wired into BODHA after v1.1:
a persistent workspace for the computer, a computer toggle in the chat, the Agenta
research agent, TinyFish as a second search engine, and OpenViking as a memory layer.
It also documents the security incident found while doing it — read §6 first if you
are short of time.

---

## 1. What changed, in one table

| # | Feature | Env var(s) | Code | If it is missing |
|---|---|---|---|---|
| 1 | Web search: Tavily → **TinyFish** → keyless | `TAVILY_API_KEY`, `TINYFISH_API_KEY` | `src/lib/web.ts` | falls through to the next engine; never errors |
| 2 | **Agenta** research agent | `AGENTA_API_KEY` (+ host/project/agent) | `src/lib/research/agenta.ts` | research requests use search + the top page instead |
| 3 | **OpenViking** memory | `OPENVIKING_URL` / `OPENVIKING_API_KEY` | `src/lib/memory/viking.ts` | the tutor simply remembers nothing |
| 4 | Persistent **workspace** (per student) | Firebase Admin (already set) | `src/lib/workspace/store.ts`, `/api/workspace` | falls back to local files in dev |
| 5 | **Computer toggle** in chat + workspace drawer | `E2B_API_KEY` | `src/components/Composer.tsx`, `WorkspaceDrawer.tsx`, chat route | the toggle still appears; tasks fall back to a tutor answer |
| 6 | **Cloud189** cold storage | none in the app | `scripts/cloud189-backup.mjs` | nothing — it is an offline tool |

Every one of them **fails soft**: a missing key, a dead endpoint or a timeout changes
how BODHA answers, never whether it answers.

---

## 2. Why Cloud189 is a backup script and not the app's storage

Cloud189 Agent Storage (`@codesentryai/cloud189`, `@codesentryai/cloud189-mcp`) is an
MCP server + CLI that stores an agent's memory, reports and backups on **Tianyi Cloud
189 / 天翼云盘**. It is a good, genuinely free product — and it is the wrong tool for a
Vercel deployment, for three concrete reasons:

1. **Login is a QR scan** into a session file (AES-256-GCM, mode 0600) on the machine
   running the CLI. A serverless function cannot display a QR code or keep that file.
2. **It is a CLI + MCP server, not an HTTP API.** There is no endpoint a Vercel
   function can call with a header.
3. **It stores an agent's cold data**, by design: explicit upload/download, no mount
   daemon, no delete by default. The workspace needs read-modify-write on every task.

So the split is:

- **Live workspace (what the student uses):** Firestore — `users/{uid}/workspace/{file}`
  with the bytes in ~700 KB part documents, the same Storage-free pattern already used
  for uploaded books. `src/lib/workspace/store.ts`.
- **Cold storage (backups, snapshots, archives):** Cloud189, driven from your own
  machine — `node scripts/cloud189-backup.mjs --yes`. It refuses `.env`, keys and
  certificates locally before the CLI's own Data Leak Guard is reached, and it never
  deletes anything.

Using Cloud189 with an agent on your laptop (the way it is meant to be used):

```jsonc
// ~/.cursor/mcp.json  — or the MCP config of Claude Code / OpenClaw / Cursor
{
  "mcpServers": {
    "cloud189": { "command": "npx", "args": ["-y", "@codesentryai/cloud189-mcp"] }
  }
}
```

```bash
npm install -g @codesentryai/cloud189      # CLI for humans
cloud189 login-qr                          # scan with the 天翼云盘 app, once
cloud189 list --json                       # then: upload / download / search / mkdir
cloud189 upload ./report.pdf <folderId> --json
```

---

## 3. The chat ⇄ computer toggle (and the workspace drawer)

**Toggle.** A `Computer` chip sits in the composer, next to the model chip. It is
remembered per browser (`localStorage: bodha:computer`), and it is sent with every
message as `computer: true|false`.

**When it is on, what actually happens** (`src/app/api/chats/[id]/messages/route.ts`):

- the message is tested with `looksLikeTask()` (`src/lib/agent/run.ts`): does it ask
  for an artefact (PDF / Word / Excel / CSV / chart / report / timetable), code to be
  run, or a download?
- **yes** → the message goes to BODHA's computer. The steps stream into the chat as
  inline notes (`write_file: notes.md`, `run_python: …`), the agent's summary becomes
  the answer, and every file it made is saved into the student's workspace. The reply
  then carries a **"Saved to your workspace"** card listing those files.
- **no** → an ordinary, fast tutoring answer, with a prompt note that the computer is
  switched on (so BODHA doesn't claim to have made a file it didn't).

This is deliberate: a question like *"explain the Kerala school"* must not wait for an
agent loop. Live Mode never delegates to the computer.

**Workspace drawer.** Reachable from the folder button in the chat header (with a file
count badge) or from the composer's `+` menu. It lists the files, and lets the student
**view** (text files open in place), **edit and save**, **rename**, **download** and
**delete** them. `GET/POST/DELETE /api/workspace`, owner-scoped by the signed-in user.

**Continuity.** Every agent run (chat or `/computer`) starts by hydrating the student's
saved files into its working directory and ends by flushing changes back, so a task can
continue yesterday's work. Files over 3 MB are fetched on demand rather than eagerly —
starting a task stays fast.

---

## 4. Agenta — the research agent

- **Contract:** `POST {host}/services/agent/v0/invoke?project_id=…` with
  `Authorization: ApiKey …` and `Accept: text/event-stream`; a stored agent is selected
  with `references: { workflow: { slug } }` or `{ workflow_revision: { id } }`.
- **Code:** `src/lib/research/agenta.ts`. It discovers the host (`cloud.agenta.ai` →
  `eu.cloud.agenta.ai`), discovers the project, and picks the most research-looking
  agent (`/research|web|search|deep|browse/i`) when no slug is configured — so in the
  common case **you only need `AGENTA_API_KEY`**.
- **When it runs:** explicitly research-shaped requests ("research", "deep dive", "write
  a report", "find sources", "compare X and Y"), or when *every* fast search engine came
  back empty. Normal questions never wait for it.
- **Deadlines:** 45 s on the research path, 60 s for the `research` tool inside the
  computer, 12 s when it is only standing in for a failed search. Requests are aborted
  hard at the deadline.

Accepted aliases (so whichever name was set in Vercel still works):
`AGENTA_API_KEY | AGENTA_KEY | AGENTA_TOKEN`, `AGENTA_HOST | AGENTA_URL | AGENTA_BASE_URL`,
`AGENTA_PROJECT_ID | AGENTA_PROJECT`, `AGENTA_AGENT_SLUG | AGENTA_AGENT`,
`AGENTA_AGENT_ID | AGENTA_WORKFLOW_REVISION_ID`.

---

## 5. TinyFish, and OpenViking

**TinyFish** (`GET https://api.search.tinyfish.ai?query=…`, header `X-API-Key`) is the
second engine: free within a daily allowance, 30 requests/minute, `429` when exceeded —
which is exactly the failure mode it exists to cover for Tavily. Order of preference:
Tavily → TinyFish → keyless DuckDuckGo. The engine that answered is named in the prompt
block, so the tutor can be honest about its sources.

**OpenViking** (`github.com/volcengine/OpenViking`) is the memory layer, used as a
context database over HTTP (`/api/v1/search/find`, `/api/v1/content/write`), with no new
npm dependency — the client in `src/lib/memory/viking.ts` speaks the same contract as the
official `@openviking/sdk`.

- **Recall:** at most 2.5 s, started in parallel with the chat route's existing reads and
  awaited in the same `Promise.all`, so it can never be the slowest thing in an answer.
  The result is injected as a *"WHAT YOU ALREADY KNOW ABOUT THIS STUDENT"* block.
- **Write-back:** after the answer has been streamed, inside Next's `after()` — durable
  on Vercel without making the student wait. Only durable statements are stored
  ("I'm preparing for boards", "call me Aarav", preferences) plus one line per new topic,
  so the memory stays small and useful.
- **Point it at a server:** set `OPENVIKING_URL` (self-hosted / Railway, e.g.
  `http://127.0.0.1:1933`). With only `OPENVIKING_API_KEY`, Volcengine's hosted
  OpenViking Service is assumed.

Deploying a server of your own (needs `uv`, Python 3.10+, and a model provider):

```bash
uv tool install openviking --upgrade && openviking-server init   # writes ~/.openviking/ov.conf
openviking-server                                                # keep this terminal open
ov status                                                        # from another terminal
```

---

## 6. Security — do this before the exhibition

**`.env` is committed to this public repository.** It is fetchable right now at
`https://raw.githubusercontent.com/srijan7815-bit/bodha-ai/main/.env` (HTTP 200, 22
secret names with real-looking values, including a 1,732-character Firebase admin
private key), and it is in the git history in at least five commits (`b0be532`,
`0a4047b`, `9ca988b`, `c6dc376`, `639cd32`). Anyone who has cloned, forked or scraped
the repo has these keys.

**Rotate, in this order** (each is a few minutes):

| Secret | Where to rotate |
|---|---|
| `FIREBASE_ADMIN_PRIVATE_KEY` (+ client email) | Firebase console → Project settings → Service accounts → **Generate new private key**, then revoke the old key |
| `NVIDIA_API_KEY` | build.nvidia.com → API keys → revoke, create new |
| `FISH_AUDIO_API_KEY` | fish.audio → API keys |
| `GROQ_API_KEY` | console.groq.com → API keys |
| `TAVILY_API_KEY` | tavily.com → dashboard |
| `E2B_API_KEY` | e2b.dev → dashboard |
| Firebase web config (`NEXT_PUBLIC_FIREBASE_*`) | not secret by design, but tighten the Firestore/Storage rules anyway |

Then remove the file from the repository **and its history**:

```bash
git rm --cached .env                          # it is already in .gitignore
git commit -m "Stop tracking .env"
git push

# history (rewrites commits — coordinate with any other clone, then force-push)
pip install git-filter-repo
git filter-repo --invert-paths --path .env --force
git remote add origin https://github.com/srijan7815-bit/bodha-ai.git
git push --force --all && git push --force --tags
```

Firestore rules worth re-checking (`firestore.rules`): the workspace lives under
`users/{uid}/workspace/…`, which is already inside the per-user path the rules protect —
confirm the rules cover the new subcollection, and that `users/{uid}/documents/.../chunks`
is not world-readable.

**Can the local `.env` be deleted?** Yes — for a *deployment*, nothing in the build reads
it: Vercel injects the same names from Project → Settings → Environment Variables, and
`npm run check:env` runs with `--warn` before the build (it prints missing names but
never fails the build). Delete it locally only after the Vercel values are confirmed:

```bash
vercel env ls            # (or check the dashboard) — then:
rm .env                  # local dev now reads the environment you export yourself
```

Keep a copy **outside the repository** (a password manager), never in git.

---

## 7. What to do from your end

1. **Rotate the keys in §6** and scrub `.env` from history. Nothing else matters as much.
2. **Add the new variables in Vercel** → Project → Settings → Environment Variables
   (Production + Preview), then redeploy:
   - `TINYFISH_API_KEY` — from tinyfish.ai → API keys (free tier).
   - `AGENTA_API_KEY` — the Agenta key; add `AGENTA_PROJECT_ID` and
     `AGENTA_AGENT_SLUG` **only if** auto-discovery picks the wrong agent.
   - `OPENVIKING_URL` + `OPENVIKING_API_KEY` — once you have an OpenViking server
     (self-hosted, Railway, or Volcengine's hosted service). Without them, memory is off.
3. **Verify:** `node scripts/check-integrations.mjs` locally, and open
   `/api/health` on the deployment — it now reports `services.search`, `services.research`,
   `services.memory`, `services.workspace` and `services.computer`.
4. **Try it in the app:** turn the `Computer` chip on, ask *"make a one-page Word handout
   on Aryabhata and save it"* — steps stream in, the file appears in the workspace drawer
   (folder icon, top right), where it can be edited, downloaded or deleted.
5. **Optional:** run `node scripts/cloud189-backup.mjs --dry-run` to see what a Tianyi 189
   snapshot would contain before you log in with the QR code.
6. **Firestore rules:** make sure the new `workspace` subcollection is covered (see §6).
