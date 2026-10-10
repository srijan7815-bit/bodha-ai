/** Reads a .env file: KEY=value, KEY="quoted value", and KEY="multi-line value". */
import { readFileSync } from 'node:fs'

export function parseEnvFile(path) {
  const out = {}
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  for (const m of text.matchAll(/^([A-Z0-9_]+)=(?:"([\s\S]*?)"[ \t]*$|(.*)$)/gm)) out[m[1]] = (m[2] ?? m[3] ?? '').trim()
  return out
}

export function loadManifest() {
  return JSON.parse(readFileSync(new URL('../env.manifest.json', import.meta.url), 'utf8'))
}
