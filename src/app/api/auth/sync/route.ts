import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase(),
})

/**
 * POST /api/auth/sync
 * Called by the client right after Firebase sign-up so the user's profile
 * (name, email) exists at users/{uid} in Firestore. Verifies the Firebase
 * ID token from the Authorization header.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token' }, { status: 401 })
  }

  const { getAdmin } = await import('@/lib/firebase/admin')
  let admin
  try {
    admin = await getAdmin()
  } catch {
    admin = null
  }
  if (!admin) {
    return NextResponse.json({ error: 'Firebase is not configured on the server' }, { status: 503 })
  }

  try {
    const decoded = await admin.auth.verifyIdToken(token)
    if (decoded.email?.toLowerCase() !== parsed.data.email) {
      return NextResponse.json({ error: 'Token does not match email' }, { status: 403 })
    }

    const userRef = admin.db.collection('users').doc(decoded.uid)
    const doc = await userRef.get()

    if (!doc.exists) {
      await userRef.set({
        email: parsed.data.email,
        name: parsed.data.name,
        createdAt: Timestamp.now(),
      })
    } else if (!doc.data()?.name) {
      await userRef.update({ name: parsed.data.name })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[auth/sync]', (err as Error).message)
    return NextResponse.json({ error: 'Sync failed' }, { status: 401 })
  }
}
