import { authFetch } from '@/lib/firebase/client-token'

/** One request body must stay under the hosting platform's ~4.5 MB cap. */
export const PART_BYTES = 3 * 1024 * 1024

/** Files up to this size go in a single request, as they always have. */
export const SINGLE_REQUEST_MAX = 3.5 * 1024 * 1024

export interface UploadOutcome {
  ok: boolean
  error?: string
  ocrPending?: boolean
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Sends a big file in 3 MB pieces, one after another, retrying a piece that
 * fails (phone networks drop), then asks the server to join and read it.
 * `onProgress` gets 0–1 for the sending part.
 */
export async function uploadInParts(
  file: File,
  title: string,
  onProgress: (fraction: number) => void,
): Promise<UploadOutcome> {
  const uploadId = crypto.randomUUID()
  const total = Math.max(1, Math.ceil(file.size / PART_BYTES))

  for (let index = 0; index < total; index++) {
    const piece = file.slice(index * PART_BYTES, Math.min(file.size, (index + 1) * PART_BYTES))
    let sent = false
    let lastError = ''
    for (let attempt = 0; attempt < 4 && !sent; attempt++) {
      try {
        const res = await authFetch(`/api/documents/upload?uploadId=${uploadId}&index=${index}&total=${total}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: piece,
        })
        if (res.ok) {
          sent = true
        } else {
          const data = await res.json().catch(() => ({}))
          lastError = data.error ?? ''
          // Client mistakes will not fix themselves; only retry server/network trouble.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) break
        }
      } catch {
        lastError = 'The connection dropped.'
      }
      if (!sent) await sleep(600 * (attempt + 1))
    }
    if (!sent) return { ok: false, error: lastError || 'The upload was interrupted. Please try again.' }
    onProgress((index + 1) / total)
  }

  const res = await authFetch(`/api/documents/upload?uploadId=${uploadId}&total=${total}&complete=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, mime: file.type, title }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: data.error ?? 'BODHA could not read that file. Please try again.' }
  return { ok: true, ocrPending: Boolean(data.ocrPending) }
}
