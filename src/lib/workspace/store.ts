/**
 * The student's persistent workspace — the files BODHA's computer makes for them.
 *
 * Before this module existed the workspace was a temporary folder that was deleted
 * the moment an agent run finished: the files only survived if the student pressed
 * Download in the same breath. Now they belong to the student, so they can be
 * listed, opened, edited, downloaded and deleted from the chat at any later time.
 *
 * Where the bytes live follows the app's existing rule (see lib/store/index.ts):
 *   • Firebase Admin configured → Firestore: users/{uid}/workspace/{fileId}
 *     with the bytes in ~700 KB part documents, exactly like uploaded books —
 *     Storage-free, so no billing account is required.
 *   • Firebase not configured → the local file store (data/bodha/workspace/<uid>),
 *     so `npm run dev` works with no cloud at all.
 *
 * Cloud189 (Tianyi 189) is deliberately *not* used here: it authenticates with a
 * QR scan into a CLI session file on a real machine, which a serverless function
 * cannot hold. It is wired up as the cold-storage/backup tier instead —
 * see scripts/cloud189-backup.mjs.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isFirebaseAdminConfigured } from '@/lib/firebase/admin'
import { mimeOf } from './mime'

export interface WorkspaceFile {
  name: string
  size: number
  mime: string
  updatedAt: string
}

/** Ceilings, matching the agent's own limits so the two can never disagree. */
export const WS_MAX_FILE = 5 * 1024 * 1024
export const WS_MAX_FILES = 24
export const WS_MAX_TOTAL = 12 * 1024 * 1024

const CHUNK_BYTES = 700 * 1024
const FS_ROOT = () => path.join(process.cwd(), 'data', 'bodha', 'workspace')

/* ─────────────────────────── safe names ─────────────────────────── */

/**
 * A name is only ever used to build a path *and* a Firestore document id, so it is
 * validated once, here, and everything downstream can trust the result.
 */
export function safeName(raw: string): string {
  const clean = path.posix
    .normalize(String(raw || '').replace(/\\/g, '/'))
    .replace(/^\/+/, '')
    .replace(/^(\.\.\/)+/, '')
  if (
    !clean ||
    clean === '.' ||
    clean.includes('..') ||
    clean.split('/').length > 4 ||
    clean.length > 120 ||
    !/^[\w\u0900-\u097F .\-/()]+$/.test(clean)
  ) {
    throw new Error(`"${raw}" is not a usable file name (use simple names like report.pdf or notes/day1.md)`)
  }
  return clean
}

/* ─────────────────────────── local (dev) backend ─────────────────────────── */

async function fsList(ownerId: string): Promise<WorkspaceFile[]> {
  const root = path.join(FS_ROOT(), ownerId)
  const out: WorkspaceFile[] = []
  const walk = async (rel: string) => {
    let entries
    try {
      entries = await fs.readdir(path.join(root, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const next = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(next)
      else {
        const stat = await fs.stat(path.join(root, next))
        out.push({ name: next, size: stat.size, mime: mimeOf(next), updatedAt: stat.mtime.toISOString() })
      }
    }
  }
  await walk('')
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function fsPath(ownerId: string, name: string): string {
  return path.join(FS_ROOT(), ownerId, safeName(name))
}

/* ─────────────────────────── Firestore backend ─────────────────────────── */

async function firestore() {
  const { requireAdmin } = await import('@/lib/firebase/admin')
  const admin = await requireAdmin()
  const files = (uid: string) => admin.db.collection('users').doc(uid).collection('workspace')
  return { admin, files }
}

const fileId = (name: string) => encodeURIComponent(safeName(name))

/* ─────────────────────────── public API ─────────────────────────── */

export function workspaceMode(): 'firestore' | 'file' {
  return isFirebaseAdminConfigured() ? 'firestore' : 'file'
}

export async function listWorkspaceFiles(ownerId: string): Promise<WorkspaceFile[]> {
  if (!isFirebaseAdminConfigured()) return fsList(ownerId)
  try {
    const { files } = await firestore()
    const snap = await files(ownerId).get()
    return snap.docs
      .map(d => {
        const data = d.data() as { name?: string; size?: number; updatedAt?: string }
        const name = String(data.name ?? '')
        return { name, size: Number(data.size ?? 0), mime: mimeOf(name), updatedAt: String(data.updatedAt ?? new Date().toISOString()) }
      })
      .filter(f => f.name)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch (err) {
    console.warn('[workspace] listing failed:', (err as Error).message)
    return []
  }
}

export async function readWorkspaceFile(ownerId: string, name: string): Promise<{ file: WorkspaceFile; bytes: Buffer } | null> {
  const safe = safeName(name)
  if (!isFirebaseAdminConfigured()) {
    try {
      const target = fsPath(ownerId, safe)
      const [bytes, stat] = await Promise.all([fs.readFile(target), fs.stat(target)])
      return { file: { name: safe, size: bytes.length, mime: mimeOf(safe), updatedAt: stat.mtime.toISOString() }, bytes }
    } catch {
      return null
    }
  }
  try {
    const { files } = await firestore()
    const docId = fileId(safe)
    const meta = await files(ownerId).doc(docId).get()
    if (!meta.exists) return null
    const data = meta.data() as { size?: number; updatedAt?: string }
    const parts = await files(ownerId).doc(docId).collection('chunks').orderBy('index').get()
    const buffers = parts.docs.map(d => {
      const raw = d.data().bytes
      if (Buffer.isBuffer(raw)) return raw as Buffer
      if (raw && typeof raw === 'object' && 'value' in raw) return Buffer.from((raw as { value: string }).value, 'base64')
      return Buffer.alloc(0)
    })
    const bytes = Buffer.concat(buffers)
    return {
      file: { name: safe, size: Number(data.size ?? bytes.length), mime: mimeOf(safe), updatedAt: String(data.updatedAt ?? new Date().toISOString()) },
      bytes,
    }
  } catch (err) {
    console.warn('[workspace] read failed:', (err as Error).message)
    return null
  }
}

export async function writeWorkspaceFile(ownerId: string, rawName: string, bytes: Buffer): Promise<WorkspaceFile> {
  const name = safeName(rawName)
  if (!bytes.length) throw new Error('that file is empty')
  if (bytes.length > WS_MAX_FILE) throw new Error('a workspace file cannot be larger than 5 MB')

  const existing = await listWorkspaceFiles(ownerId)
  const total = existing.filter(f => f.name !== name).reduce((sum, f) => sum + f.size, 0) + bytes.length
  if (total > WS_MAX_TOTAL) throw new Error('the workspace is full (12 MB) — delete something first')
  if (!existing.some(f => f.name === name) && existing.length >= WS_MAX_FILES) throw new Error('too many files in the workspace (24)')

  const updatedAt = new Date().toISOString()

  if (!isFirebaseAdminConfigured()) {
    const target = fsPath(ownerId, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, bytes)
    return { name, size: bytes.length, mime: mimeOf(name), updatedAt }
  }

  const { admin, files } = await firestore()
  const ref = files(ownerId).doc(fileId(name))
  // Replace the parts: delete the old ones, write the new ones, then the metadata.
  const old = await ref.collection('chunks').get()
  const total_new = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES))
  for (const d of old.docs) if (Number(d.id) >= total_new) await d.ref.delete()

  let batch = admin.db.batch()
  let pending = 0
  for (let i = 0; i < total_new; i++) {
    const part = bytes.subarray(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, bytes.length))
    batch.set(ref.collection('chunks').doc(String(i).padStart(4, '0')), { index: i, bytes: Buffer.from(part) })
    if (++pending === 8) {
      await batch.commit()
      batch = admin.db.batch()
      pending = 0
    }
  }
  if (pending) await batch.commit()
  await ref.set({ name, size: bytes.length, updatedAt, mime: mimeOf(name) })
  return { name, size: bytes.length, mime: mimeOf(name), updatedAt }
}

export async function deleteWorkspaceFile(ownerId: string, rawName: string): Promise<boolean> {
  const name = safeName(rawName)
  if (!isFirebaseAdminConfigured()) {
    try {
      await fs.rm(fsPath(ownerId, name), { force: true })
      return true
    } catch {
      return false
    }
  }
  try {
    const { files } = await firestore()
    const ref = files(ownerId).doc(fileId(name))
    const parts = await ref.collection('chunks').get()
    for (const d of parts.docs) await d.ref.delete()
    await ref.delete()
    return true
  } catch (err) {
    console.warn('[workspace] delete failed:', (err as Error).message)
    return false
  }
}

/** Renames by copying then deleting; false when the source does not exist. */
export async function renameWorkspaceFile(ownerId: string, from: string, to: string): Promise<boolean> {
  const target = safeName(to)
  if (target === safeName(from)) return true
  const found = await readWorkspaceFile(ownerId, from)
  if (!found) return false
  await writeWorkspaceFile(ownerId, target, found.bytes)
  await deleteWorkspaceFile(ownerId, from)
  return true
}

/** Totals for the UI's little "12 MB of 24 files" line. */
export async function workspaceSummary(ownerId: string): Promise<{ files: WorkspaceFile[]; totalBytes: number; mode: 'firestore' | 'file' }> {
  const files = await listWorkspaceFiles(ownerId)
  return { files, totalBytes: files.reduce((sum, f) => sum + f.size, 0), mode: workspaceMode() }
}
