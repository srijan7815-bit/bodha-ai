#!/usr/bin/env node
/**
 * Checks that BODHA's environment variables are set.
 *
 *   npm run check:env                 check the current environment (what Vercel provides)
 *   node scripts/check-env.mjs --file .env   check a local file instead
 *   --warn   print problems but always exit 0 (used before `next build`)
 *
 * Only NAMES are printed — never values.
 */
import { loadManifest, parseEnvFile } from './lib-env.mjs'

const manifest = loadManifest()
const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const warnOnly = args.includes('--warn')
const env = fileIdx >= 0 ? parseEnvFile(args[fileIdx + 1]) : process.env

const has = name => Boolean((env[name] ?? '').trim())
const missingRequired = manifest.required.filter(v => !has(v.name))
const missingRecommended = manifest.recommended.filter(v => !has(v.name))

if (!warnOnly || missingRequired.length) {
  console.log('\nBODHA environment check')
  for (const v of manifest.required) console.log(`  ${has(v.name) ? '✓' : '✗'} ${v.name}`)
  for (const v of manifest.recommended) console.log(`  ${has(v.name) ? '✓' : '·'} ${v.name}  (recommended${has(v.name) ? '' : ' — default will be used'})`)
}
if (missingRequired.length) {
  console.log(`\n${warnOnly ? 'WARNING' : 'MISSING'}: ${missingRequired.length} required variable(s) not set: ${missingRequired.map(v => v.name).join(', ')}`)
  console.log('Without the Firebase ones the app falls back to a TEMPORARY file store and forgets every chat. See docs/ENVIRONMENT.md.\n')
  process.exit(warnOnly ? 0 : 1)
}
if (!warnOnly) console.log('\nAll required variables are set.\n')
