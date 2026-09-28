#!/usr/bin/env node
/**
 * Copies the pdf.js worker from node_modules into /public so the browser
 * can load it from a stable URL (/pdf.worker.min.mjs) — matched to the
 * installed pdfjs-dist version. Runs automatically on `npm install`.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
const destDir = join(root, 'public')
const dest = join(destDir, 'pdf.worker.min.mjs')

try {
  if (!existsSync(src)) {
    console.log('[bodha] pdf worker source not found (skipping copy)')
    process.exit(0)
  }
  mkdirSync(destDir, { recursive: true })
  copyFileSync(src, dest)
  console.log('[bodha] copied pdf.worker.min.mjs -> public/')
} catch (err) {
  console.warn('[bodha] failed to copy pdf worker:', err.message)
  process.exit(0)
}
