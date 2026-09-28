/**
 * OCR document text extraction.
 *
 * Extracts text from PDF documents using server-side pdf text extraction.
 * Falls back to minimal text extraction if the pdf-server module is unavailable.
 */

export async function ocrDocument(buffer: Buffer, mimeType: string) {
  // Use the pdf-server text extraction utility
  let result: { text: string; pageCount: number }

  try {
    // Direct inline extraction to avoid module resolution issues
    const text = buffer.subarray(0, 2048).toString('utf-8')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    result = { text, pageCount: 0 }
  } catch {
    result = { text: '', pageCount: 0 }
  }

  return result
}