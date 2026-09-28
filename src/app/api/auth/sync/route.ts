import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
})

/**
 * POST /api/auth/sync
 * Called after client-side Firebase registration to sync the user's
 * profile into the Firestore users collection. Verifies the Firebase ID token.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Verify the Firebase ID token from the Authorization header
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return NextResponse.json({ error: 'Missing auth token' }, { status: 401 })
    }

    const decoded = await adminAuth.verifyIdToken(token)
    if (decoded.email?.toLowerCase() !== parsed.data.email.toLowerCase()) {
      return NextResponse.json({ error: 'Token does not match email' }, { status: 403 })
    }

    const userRef = adminDb.collection('users').doc(decoded.uid)
    const doc = await userRef.get()

    if (!doc.exists) {
      await userRef.set({
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        createdAt: Timestamp.now(),
      })
    } else if (!doc.data()?.name && parsed.data.name) {
      await userRef.update({ name: parsed.data.name })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[auth/sync]', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}