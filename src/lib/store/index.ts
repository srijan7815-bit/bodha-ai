import { join } from 'node:path'
import { hashPassword } from '@/lib/auth'
import type { Store } from '@/lib/types'
import { FileStore } from './file'
import { FirebaseStore } from './firebase'

/**
 * Store selection + lifecycle.
 *
 *  - Firebase Admin env vars set  → FirebaseStore (cloud sync across devices)
 *  - otherwise                    → FileStore under data/bodha (zero-config demo)
 *
 * Both adapters implement the exact same interface and provision +
 * seed themselves on boot, so the app is identical in either mode.
 */

let storePromise: Promise<Store> | null = null

export const DEMO_EMAIL = 'demo@bodha.ai'
export const DEMO_PASSWORD = 'bodha-demo'

function isFirebaseConfigured(): boolean {
  return !!(
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()
  )
}

async function bootstrap(store: Store): Promise<Store> {
  await store.init()

  // Seed the demo account so anyone can try BODHA instantly.
  const existing = await store.getUserByEmail(DEMO_EMAIL)
  if (!existing) {
    const demo = await store.createUser({
      email: DEMO_EMAIL,
      name: 'Demo Student',
      passwordHash: hashPassword(DEMO_PASSWORD),
    })
    const chat = await store.createChat({
      userId: demo.id,
      title: 'Welcome to BODHA ✦',
      documentId: null,
    })
    await store.createMessage(
      chat.id,
      'assistant',
      [
        'Namaste, and welcome to **BODHA** — your patient, warm-hearted AI tutor. 🪔',
        '',
        'A few things you can do here:',
        '',
        '- **Ask me anything you are learning** — maths, physics, history, languages, coding… I teach step by step and check your understanding along the way.',
        '- **Upload a book or PDF** in the *Library* and read it in a calm, book-style reader — then ask me about any passage.',
        '- **Talk to me by voice** — tap the mic and just speak your question.',
        '- **Run code** — I can teach web programming with live examples you can run in the sandbox.',
        '',
        '> *Bodha* (बोध) means "awakening" in Sanskrit — that moment when understanding clicks.',
        '',
        'I was created by **Srijan Singh and Parv Mishra**. What shall we learn today?',
      ].join('\n'),
    )
  }

  return store
}

export function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = isFirebaseConfigured()
      ? bootstrap(new FirebaseStore())
      : bootstrap(new FileStore(join(process.cwd(), 'data', 'bodha')))
  }
  return storePromise.catch(err => {
    storePromise = null
    throw err
  })
}

export function storeMode(): 'firebase' | 'file' {
  return isFirebaseConfigured() ? 'firebase' : 'file'
}