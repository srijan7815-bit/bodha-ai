#!/usr/bin/env node
/**
 * Copies the variables in your LOCAL .env into your Vercel project, so the file
 * can then be removed from the repository.
 *
 *   npm i -g vercel && vercel login && vercel link     (once)
 *   node scripts/push-env-to-vercel.mjs --dry          (see what would be sent)
 *   node scripts/push-env-to-vercel.mjs                (send it)
 *   vercel --prod                                      (rebuild with the new variables)
 *
 * Only variables named in env.manifest.json are sent; the unused ones are skipped.
 * Values travel over stdin to the Vercel CLI and are never printed.
 * By hand instead: Vercel dashboard → Settings → Environment Variables → "Import .env".
 *
 *   --envs production,preview     which Vercel environments to fill (default both)
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadManifest, parseEnvFile } from './lib-env.mjs'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const envs = (args[args.indexOf('--envs') + 1] && args.includes('--envs') ? args[args.indexOf('--envs') + 1] : 'production,preview').split(',')
const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : '.env'

if (!existsSync(file)) {
  console.error(`No ${file} here — nothing to send.`)
  process.exit(1)
}
const manifest = loadManifest()
const local = parseEnvFile(file)
const names = [...manifest.required.map(v => v.name), ...manifest.recommended.map(v => v.name), ...manifest.optional]

let sent = 0
for (const name of names) {
  const value = local[name]
  if (!value) continue
  for (const target of envs) {
    if (dry) {
      console.log(`  would send ${name} (${value.length} chars) → ${target}`)
      continue
    }
    const res = spawnSync('vercel', ['env', 'add', name, target, '--force'], { input: value, encoding: 'utf8' })
    console.log(res.status === 0 ? `  ✓ ${name} → ${target}` : `  ✗ ${name} → ${target} (${(res.stderr || res.error?.message || 'failed').trim().split('\n').pop()})`)
    if (res.status === 0) sent++
  }
}
console.log(dry ? '\nDry run — nothing was sent.' : `\nSent ${sent} value(s). Now redeploy, and check /api/health while signed in: env.ok must be true.`)
