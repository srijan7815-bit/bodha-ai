/**
 * File types BODHA's workspace understands.
 *
 * Kept in its own tiny module (no pdf-lib / docx / xlsx imports) so the workspace
 * API route and the UI can ask "what is this file?" without pulling the document
 * generators — and the agent's Computer — into the same cold start.
 */

export const MIME: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  xml: 'application/xml',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  log: 'text/plain',
  tex: 'text/x-tex',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/typescript',
  css: 'text/css',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
}

export function mimeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

/** Files the workspace UI can show and edit as text. */
export function isTextFile(name: string): boolean {
  const mime = mimeOf(name)
  return /^text\//.test(mime) || /json|javascript|typescript|xml|yaml|x-tex|x-python/.test(mime)
}
