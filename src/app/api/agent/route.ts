import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { runAgent } from '@/lib/agent/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const bodySchema = z.object({ task: z.string().trim().min(4).max(1500) })

/**
 * POST /api/agent — give BODHA's computer a task. Streams one JSON object per
 * line: step → result → … → final (with the finished files, base64) or error.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`agent:${user.id}:${clientIp(req)}`, 8, 10 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'The computer is busy — wait a few minutes before the next task.' }, { status: 429 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Describe the task in a sentence or two.' }, { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (frame: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
      try {
        for await (const frame of runAgent(parsed.data.task, req.signal)) send(frame)
      } catch (err) {
        send({ t: 'error', message: (err as Error).message.slice(0, 160) })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
}
