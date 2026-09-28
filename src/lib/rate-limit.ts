import { NextRequest } from 'next/server'

const buckets = new Map<string, { count: number; resetAt: number }>()

/**
 * Simple in-memory rate limiter.
 * Key format: "prefix:identifier" (e.g., "msg:user123:192.168.1.1")
 * Returns { ok: true } if under limit, { ok: false, retryAfter: seconds } if exceeded.
 */
export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter?: number } {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }

  if (bucket.count >= max) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count++
  return { ok: true }
}

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

/** Cleanup old buckets periodically (call in a cron or on startup) */
export function cleanupRateLimit(): void {
  const now = Date.now()
  buckets.forEach((bucket, key) => {
    if (now > bucket.resetAt) buckets.delete(key)
  })
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimit, 5 * 60 * 1000)
}