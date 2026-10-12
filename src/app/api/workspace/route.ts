import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { isTextFile, mimeOf } from '@/lib/workspace/mime'
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  renameWorkspaceFile,
  workspaceError,
  workspaceMode,
  writeWorkspaceFile,
  WS_MAX_FILE,
  WS_MAX_FILES,
  WS_MAX_TOTAL,
} from '@/lib/workspace/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The student's workspace — the files BODHA's computer has made for them.
 *
 *   GET    /api/workspace              → { files, totalBytes, mode }
 *   GET    /api/workspace?name=…        → one file (text as UTF-8, binary as base64)
 *   POST   /api/workspace { name, content | base64 }   → save/overwrite a file
 *   POST   /api/workspace { name, renameTo }           → rename
 *   DELETE /api/workspace?name=…        → delete
 *
 * Every operation is owner-scoped: the files live under the signed-in student's own
 * path in Firestore (or the local store in dev), and nothing here can touch another
 * account's workspace.
 */

const writeSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    content: z.string().max(WS_MAX_FILE).optional(),
    base64: z.string().max(Math.ceil(WS_MAX_FILE * 1.4)).optional(),
    renameTo: z.string().trim().min(1).max(120).optional(),
  })
  .refine(v => v.renameTo !== undefined || v.content !== undefined || v.base64 !== undefined, {
    message: 'send content, base64 or renameTo',
  })

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const name = req.nextUrl.searchParams.get('name')
  if (!name) {
    const files = await listWorkspaceFiles(user.id)
    return NextResponse.json({
      files,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
      limits: { fileBytes: WS_MAX_FILE, totalBytes: WS_MAX_TOTAL, files: WS_MAX_FILES },
      mode: workspaceMode(),
      // Non-null when the storage layer refused the last call — the drawer shows it,
      // so an unreachable workspace never looks like an empty one.
      degraded: workspaceError(),
    })
  }

  try {
    const found = await readWorkspaceFile(user.id, name)
    if (!found) return NextResponse.json({ error: 'No such file in the workspace' }, { status: 404 })
    const mime = found.file.mime || mimeOf(name)
    return NextResponse.json({
      file: found.file,
      mime,
      text: isTextFile(name) ? found.bytes.toString('utf-8') : null,
      base64: isTextFile(name) ? null : found.bytes.toString('base64'),
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 160) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`workspace:${user.id}:${clientIp(req)}`, 60, 5 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many workspace changes just now — try again in a minute.' }, { status: 429 })

  const parsed = writeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  try {
    const { name, content, base64, renameTo } = parsed.data
    if (renameTo !== undefined) {
      const ok = await renameWorkspaceFile(user.id, name, renameTo)
      if (!ok) return NextResponse.json({ error: 'No such file in the workspace' }, { status: 404 })
      const files = await listWorkspaceFiles(user.id)
      return NextResponse.json({ ok: true, files })
    }

    const bytes = base64 !== undefined ? Buffer.from(base64, 'base64') : Buffer.from(content ?? '', 'utf-8')
    const file = await writeWorkspaceFile(user.id, name, bytes)
    const files = await listWorkspaceFiles(user.id)
    return NextResponse.json({ ok: true, file, files, totalBytes: files.reduce((sum, f) => sum + f.size, 0) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 160) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const name = req.nextUrl.searchParams.get('name')
  if (!name) return NextResponse.json({ error: 'Which file?' }, { status: 400 })

  try {
    const ok = await deleteWorkspaceFile(user.id, name)
    if (!ok) return NextResponse.json({ error: 'No such file in the workspace' }, { status: 404 })
    const files = await listWorkspaceFiles(user.id)
    return NextResponse.json({ ok: true, files, totalBytes: files.reduce((sum, f) => sum + f.size, 0) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 160) }, { status: 400 })
  }
}
