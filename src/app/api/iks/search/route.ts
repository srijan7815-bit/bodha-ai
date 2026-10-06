import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { searchShelf } from '@/lib/iks/corpus'

export const dynamic = 'force-dynamic'

/**
 * GET /api/iks/search?q=… — reads the Indian Knowledge Systems shelf.
 *
 * The same retrieval that grounds a chat answer, exposed so the shelf page can
 * be searched directly. Signed-in students only, and rate-limited, because it is
 * the app's own index rather than a public search service.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`iks:${user.id}:${clientIp(req)}`, 120, 10 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many searches just now.' }, { status: 429 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 300)
  if (q.length < 3) return NextResponse.json({ query: q, results: [] })

  try {
    const hits = await searchShelf(q, { limit: 12, keepShare: 0.25 })
    return NextResponse.json({
      query: q,
      results: hits.map(hit => ({
        id: hit.passage.id,
        workId: hit.work.id,
        title: hit.work.title,
        sanskrit: hit.work.sanskrit ?? null,
        ref: hit.passage.ref,
        translator: hit.work.translator,
        year: hit.work.year,
        domain: hit.work.domain,
        sourceUrl: hit.work.sourceUrl,
        excerpt: hit.passage.text.length > 900 ? `${hit.passage.text.slice(0, 900).trim()}…` : hit.passage.text,
        score: Number(hit.score.toFixed(3)),
      })),
    })
  } catch (err) {
    console.warn('[iks] search failed:', (err as Error).message)
    return NextResponse.json({ error: 'The shelf could not be read just now.' }, { status: 500 })
  }
}
