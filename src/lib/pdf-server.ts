/**
 * Server-side PDF text extraction.
 *
 * Primary (spec, step 2): nvidia/nemotron-parse via NVIDIA NIM — OCR for
 * scanned documents. See src/lib/ocr.ts (wired in the documents upload flow).
 *
 * This module is the always-available fallback: real text-layer extraction
 * with pdfjs-dist (legacy Node build, no worker). Works without any API key
 * so the Library is fully functional offline.
 */

export interface PdfExtract {
  text: string
  pageCount: number
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtract> {
  type PdfJs = typeof import('pdfjs-dist')
  // Legacy build runs in Node without a worker thread.
  const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs

  const doc = await lib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    // @ts-expect-error Node needs this off in some environments
    disableFontFace: true,
  }).promise

  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      try {
        const content = await page.getTextContent()
        let lastY: number | undefined
        let line = ''
        const lines: string[] = []
        for (const item of content.items as Array<{ str: string; transform: number[]; hasEOL?: boolean }>) {
          const y = item.transform?.[5]
          if (lastY !== undefined && Math.abs(y - lastY) > 2) {
            lines.push(line.trim())
            line = ''
          }
          line += item.str
          if (item.hasEOL) {
            lines.push(line.trim())
            line = ''
          }
          lastY = y
        }
        if (line.trim()) lines.push(line.trim())
        pages.push(lines.filter(Boolean).join('\n'))
      } finally {
        page.cleanup()
      }
    }

    const text = pages
      .map((p, idx) => `— page ${idx + 1} —\n${p}`)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return { text, pageCount: doc.numPages }
  } finally {
    await doc.destroy()
  }
}
