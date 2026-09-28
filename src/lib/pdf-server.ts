import type { DocumentMeta } from '@/lib/types'

/**
 * Server-side PDF text extraction — simplified, no pdf-parse dependency.
 * For production, integrate nvidia/nemotron-parse via the NIM endpoint.
 * Currently falls back to a lightweight stub for build compatibility.
 */
export async function extractPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  // Minimal text extraction: return first 2KB as preview, 0 pages
  const text = buffer.subarray(0, 2048).toString('utf-8')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, pageCount: 0 }
}
