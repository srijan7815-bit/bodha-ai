# BODHA AI 🪔

A warm, reading-optimized educational AI tutor. Chat, upload books and read them in a calm book-style reader, talk by voice, and learn to code in a live sandbox.

**Created by Srijan Singh and Parv Mishra.**

> *Bodha* (बोध) means "awakening" in Sanskrit — that moment when understanding clicks.

---

## What it does

- **Chat with BODHA** — streaming answers from `moonshotai/kimi-k3` via NVIDIA NIM, with a strictly educational system prompt. Chat history is stored per-user in Firestore and follows students across devices.
- **Documents + OCR** — upload PDFs and text files to Firebase Storage, extract text with `nvidia/nemotron-parse` (server-side pdf-parse for standard PDFs), and ask questions about any passage.
- **Voice** — read-aloud (TTS) on any message via Fish Audio `s2.1-pro-free`, mic dictation (STT) via Fish Audio `transcribe-1` (with browser Web Speech fallback).
- **PDF reading mode** — `pdfjs-dist` rasterizes pages with selectable text, sepia/paper/night reading themes, progress memory, keyboard navigation, page-turn animation via `react-pageflip`.
- **Tools + sandbox + live preview** — Tavily web search + E2B Code Interpreter tool-calling; multi-file generations get a dev server started in-sandbox with the `{port}-{id}.e2b.app` preview URL embedded beside the chat.
- **Live Mode** — an avatar with idle / listening / thinking / speaking / minimized states, amplitude-driven lip sync from TTS audio.
- **Autosave** — debounce-saved composer drafts, restored when under 20 minutes old.

---

## Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui |
| Auth | Firebase Auth (email/password + Google) |
| Data | Firestore — `users/{uid}/chats/{chatId}/messages/{messageId}`, per-user security rules |
| Uploads | Firebase Storage |
| AI model | `moonshotai/kimi-k3` via NVIDIA NIM (`https://integrate.api.nvidia.com/v1`) |
| OCR | `nvidia/nemotron-parse` |
| TTS | Fish Audio `s2.1-pro-free` |
| STT | Fish Audio `transcribe-1` |
| Sandbox | E2B Code Interpreter (`@e2b/code-interpreter`) |
| Search | Tavily |
| Deploy | Vercel |

---

## Getting started

```bash
npm install
cp .env.example .env   # fill in your keys
npm run dev            # http://localhost:3000
```

### Environment variables

See [`.env.example`](.env.example) for the full list. The essentials:

- **`NVIDIA_API_KEY`** — free key at [build.nvidia.com](https://build.nvidia.com) (Sign in → API Keys)
- **`NEXT_PUBLIC_FIREBASE_*`** — from a Firebase project with Auth (Email/Password + Google), Firestore, and Storage enabled
- **`FIREBASE_ADMIN_*`** — service-account credentials for server-side Firestore access
- **`FISH_AUDIO_API_KEY`** — for TTS/STT ([fish.audio](https://fish.audio))
- **`E2B_API_KEY`** — for the code sandbox ([e2b.dev](https://e2b.dev))
- **`TAVILY_API_KEY`** — for web search ([tavily.com](https://tavily.com))

### Firestore security rules

Deploy with the Firebase CLI:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Rules limit each user to their own data — see [`firestore.rules`](firestore.rules).

---

## Visual design

Warm palette: background `#FAF7F2`, text `#2B2723`, accent `#C1633B`, card `#F1EAE0`.
UI font Inter; message body a humanist serif (Source Serif 4), 16–17px, 1.6–1.7 line height, ~700px max content width. Clean, reading-first layout, minimal chrome.

---

## License

Private project. © Srijan Singh and Parv Mishra.
