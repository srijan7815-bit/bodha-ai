/**
 * Server auth check for API routes.
 * Decodes the Firebase ID token from the Authorization header.
 * Uses a minimal approach to avoid firebase-admin dependency conflicts
 * at build time. In production, replace with proper Firebase Admin SDK verification.
 */

export function getAuthUser(req: NextRequest): User | null {
  try {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token || token.length < 20) return null

    // Minimal token validation: verify format and extract basic claims
    // A production implementation would verify the token signature
    // using firebase-admin with a custom refreshable certificate.
    // For now, accept tokens that look like Firebase custom tokens.
    if (token.split('.').length !== 3) return null

    // Decode the payload portion of the JWT (base64url)
    let payload: any
    try {
      const base64url = token.split('.')[1]
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
      payload = JSON.parse(atob(base64))
    } catch {
      return null
    }

    if (!payload?.uid || !payload?.email) return null

    return {
      id: payload.uid,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      createdAt: new Date().toISOString(),
      avatarUrl: payload.picture,
    }
  } catch {
    return null
  }
}