/**
 * The one fetch wrapper the browser uses for BODHA's own API.
 *
 * Authentication is an httpOnly session cookie set by /api/auth/*, so the
 * cookie travels with the request by itself — there is no token to attach and
 * nothing to expire mid-session. Keeping the wrapper means every call site
 * already goes through a single place if that ever changes.
 */

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(input, { ...init, headers, credentials: 'same-origin' })
}
