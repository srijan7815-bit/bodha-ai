import type { PdfExtract } from './pdf-server'

/**
 * OCR — nvidia/nemotron-parse on NVIDIA NIM.
 *
 * The hosted NIM endpoint is OpenAI-compatible, and nemotron-parse is quirky:
 *
 *  - it accepts the page image *only* — any text part is rejected with
 *    "The model does not support text input" (its `input_text` upper bound is 0
 *    characters), so the request body must not carry a prompt;
 *  - it answers with a tool call (`markdown_bbox`) whose `arguments` string is a
 *    JSON array of `{ bbox: {xmin,ymin,xmax,ymax}, text, type }` blocks, and
 *    `message.content` is usually `null`.
 *
 * The blocks are therefore re-sorted into reading order (top-to-bottom, then
 * left-to-right per row) and returned as Markdown, which is exactly what the
 * BODHA reader and the tutor prompt expect.
 *
 * Server-only module: it reads NVIDIA_API_KEY, so never import it from a
 * client component.
 */

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const DEFAULT_OCR_MODEL = 'nvidia/nemotron-parse'

/** Keep a single page well inside the /api/ocr route's 60s maxDuration. */
const OCR_TIMEOUT_MS = 55_000
const OCR_MAX_TOKENS = 4096

/** A PDF page with less text than this is treated as a scan and sent to OCR. */
const SCANNED_CHARS_PER_PAGE = 120

interface ParseBlock {
  bbox?: { xmin?: number; ymin?: number; xmax?: number; ymax?: number }
  text?: unknown
  type?: string
}

interface ParseMessage {
  content?: unknown
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
}

/** True when an NVIDIA NIM key is present, so OCR can be attempted. */
export function ocrConfigured(): boolean {
  return !!process.env.NVIDIA_API_KEY?.trim()
}

/** The OCR model id (override with NVIDIA_OCR_MODEL). */
export function ocrModel(): string {
  return process.env.NVIDIA_OCR_MODEL?.trim() || DEFAULT_OCR_MODEL
}

function apiKey(): string {
  const key = process.env.NVIDIA_API_KEY?.trim()
  if (!key) throw new Error('OCR is not configured (NVIDIA_API_KEY is missing).')
  return key
}

function baseUrl(): string {
  const raw = process.env.AI_BASE_URL?.trim() || process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE_URL
  return raw.replace(/\/+$/, '')
}

/** NIM accepts PNG and JPEG data URLs only. */
function normalizeImageMime(mimeType: string): 'image/png' | 'image/jpeg' {
  const mime = (mimeType || '').toLowerCase()
  return mime.includes('png') ? 'image/png' : 'image/jpeg'
}

function blockText(block: ParseBlock): string {
  const { text } = block
  if (typeof text === 'string') return text
  if (Array.isArray(text)) return text.map(part => (typeof part === 'string' ? part : '')).join('')
  if (text && typeof text === 'object') {
    const inner = (text as { content?: unknown; text?: unknown }).content ?? (text as { text?: unknown }).text
    if (typeof inner === 'string') return inner
  }
  return ''
}

/** Top-to-bottom, then left-to-right within the same visual row. */
function readingOrder(blocks: ParseBlock[]): string[] {
  return blocks
    .map(block => ({ block, text: blockText(block).trim() }))
    .filter(entry => entry.text.length > 0)
    .sort((a, b) => {
      const ay = a.block.bbox?.ymin ?? 0
      const by = b.block.bbox?.ymin ?? 0
      if (Math.abs(ay - by) > 0.02) return ay - by
      return (a.block.bbox?.xmin ?? 0) - (b.block.bbox?.xmin ?? 0)
    })
    .map(entry => entry.text)
}

/** Decodes the tool-call `arguments` payload into blocks, tolerating wrapping. */
function parseBlocks(raw: string): ParseBlock[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  // Some deployments double-encode the value, or nest it under `data`.
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const maybeData = (parsed as { data?: unknown; blocks?: unknown }).data ?? (parsed as { blocks?: unknown }).blocks
    if (Array.isArray(maybeData)) parsed = maybeData
  }
  if (!Array.isArray(parsed)) return null

  return parsed
    .flatMap(item => (Array.isArray(item) ? item : [item]))
    .filter((item): item is ParseBlock => !!item && typeof item === 'object')
}

/** Last-resort recovery when the tool call was cut off mid-JSON. */
function salvageText(raw: string): string {
  const found: string[] = []
  const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    try {
      found.push(JSON.parse(`"${match[1]}"`) as string)
    } catch {
      found.push(match[1])
    }
  }
  return found.join('\n\n')
}

function textFromMessage(message: ParseMessage | undefined): string {
  if (!message) return ''

  const argumentsPayload = (message.tool_calls ?? [])
    .map(call => call.function?.arguments)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')

  if (argumentsPayload) {
    const blocks = parseBlocks(argumentsPayload)
    if (blocks) {
      const ordered = readingOrder(blocks)
      if (ordered.length) return ordered.join('\n\n')
    }
    return salvageText(argumentsPayload)
  }

  return typeof message.content === 'string' ? message.content : ''
}

/** Removes parser control tokens and normalises LaTeX for the Markdown reader. */
function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/<predict_[a-z_]+>/gi, '')
    .replace(/<\|[^|]*\|>/g, '')
    // `<bbox ...>text</bbox>` style spans keep their inner text.
    .replace(/<\/?bbox[^>]*>/gi, '')
    .replace(/\\\(([\s\S]*?)\\\)/g, (_all, math: string) => `$${math.trim()}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_all, math: string) => `$$\n${math.trim()}\n$$`)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

/**
 * OCR a single page image (PNG/JPEG) and return its text as Markdown.
 * Throws when the service cannot be reached, so callers can map it to a 502.
 */
export async function ocrImage(buffer: Buffer, mimeType: string): Promise<string> {
  if (!buffer?.length) throw new Error('OCR received an empty image.')

  const mime = normalizeImageMime(mimeType)
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`

  let res: Response
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: ocrModel(),
        temperature: 0,
        max_tokens: OCR_MAX_TOKENS,
        // Image only — this model rejects any text input.
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] }],
      }),
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError'
      ? `timed out after ${Math.round(OCR_TIMEOUT_MS / 1000)}s`
      : (err as Error).message
    throw new Error(`OCR request failed (${reason}).`)
  }

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {
      // ignore
    }
    throw new Error(`OCR service error (HTTP ${res.status}) ${detail}`.trim())
  }

  let payload: { choices?: Array<{ message?: ParseMessage }> }
  try {
    payload = (await res.json()) as typeof payload
  } catch {
    throw new Error('OCR service returned a non-JSON response.')
  }

  const text = cleanMarkdown(textFromMessage(payload.choices?.[0]?.message))
  if (!text) throw new Error('OCR returned no text for that page.')
  return text
}

/**
 * Does a PDF look like a scan (image-only pages) rather than real text?
 * Text files and images are handled elsewhere; this only gates the
 * rasterise-then-OCR flow for PDFs.
 */
export function looksScanned(text: string, pageCount: number): boolean {
  const body = (text ?? '')
    .replace(/—\s*page\s*\d+\s*—/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Nothing came out of the text layer at all — that is a scan.
  if (!body) return true

  const pages = Math.max(1, Math.floor(pageCount) || 1)

  // A single page carries very little either way, so only near-empty output
  // counts as a scan (a rasterised page yields a few stray characters at most,
  // while a real one-page worksheet still has a title or a question on it).
  if (pages === 1) return body.length < 25

  return body.length / pages < SCANNED_CHARS_PER_PAGE
}

/**
 * Generic document OCR helper: PDFs go through the text-layer extractor,
 * images through nemotron-parse, everything else is decoded as UTF-8.
 */
export async function ocrDocument(buffer: Buffer, mimeType: string): Promise<PdfExtract> {
  const mime = (mimeType || '').toLowerCase()

  if (mime.startsWith('image/')) {
    return { text: await ocrImage(buffer, mime), pageCount: 1 }
  }

  if (mime.includes('pdf') || buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    const { extractPdfText } = await import('./pdf-server')
    return extractPdfText(buffer)
  }

  return { text: buffer.toString('utf-8'), pageCount: 0 }
}
