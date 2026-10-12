#!/usr/bin/env node
/**
 * Cloud189 (Tianyi 189 / 天翼云盘) — BODHA's cold-storage tier.
 *
 * WHY THIS IS A SCRIPT AND NOT PART OF THE APP
 * --------------------------------------------
 * Cloud189 Agent Storage authenticates with a **QR scan** into a session file that
 * lives on the machine running the CLI. A Vercel function has no screen, no
 * persistent disk and no way to hold that session, so cloud189 cannot be the
 * deployed app's runtime storage. What it is genuinely good at is the thing it was
 * built for: an agent's cold storage — backups, snapshots, archives — driven from a
 * machine you control.
 *
 * So the app's live workspace lives in Firestore (see src/lib/workspace/store.ts),
 * and this script pushes a snapshot of your local data (and any exported workspace
 * files) to Tianyi 189 when you ask it to.
 *
 * USAGE
 *   npx @codesentryai/cloud189 login-qr      # once, scan with the 天翼云盘 app
 *   node scripts/cloud189-backup.mjs --dry-run
 *   node scripts/cloud189-backup.mjs --yes   # upload data/bodha + docs as a snapshot
 *
 * SAFETY
 *   • .env, keys, certificates and anything secret-looking are refused locally,
 *     before the CLI's own Data Leak Guard is even reached.
 *   • Nothing is ever deleted: every run uploads a new timestamped snapshot.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, stat, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const run = promisify(execFile)
const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry-run') || !args.has('--yes')
const FOLDER_ID = process.env.CLOUD189_FOLDER_ID || ''
const KEEP = Number(process.env.CLOUD189_KEEP || 14)

const SECRET = /(^|\/)(\.env[^/]*|.*\.(pem|key|p12|pfx|jks|keystore)|id_rsa[^/]*|.*service[-_]?account.*\.json|.*credentials?.*|\.npmrc|\.netrc)$/i
const SOURCES = ['data/bodha', 'docs', 'env.manifest.json'].filter(p => existsSync(p))

async function cloud189(commands, { json = true } = {}) {
  const bin = process.env.CLOUD189_BIN || 'cloud189'
  const argv = json ? [...commands, '--json'] : commands
  try {
    const { stdout } = await run(bin, argv, { maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60 * 1000 })
    return stdout.trim()
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'the cloud189 CLI is not installed. Install it with:\n' +
          '  npm install -g @codesentryai/cloud189\n' +
          'then log in once with:\n' +
          '  cloud189 login-qr',
      )
    }
    throw new Error(`${bin} ${argv.join(' ')} failed: ${(err.stderr || err.message || '').slice(0, 300)}`)
  }
}

/** Walks the picked directories and refuses anything that looks like a secret. */
async function collect(root, rel = '', found = []) {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true })
  for (const entry of entries) {
    const next = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (/node_modules|\.next|\.git|__pycache__/.test(entry.name)) continue
      await collect(root, next, found)
      continue
    }
    if (SECRET.test(next)) {
      console.log(`  · skipped (looks like a secret): ${next}`)
      continue
    }
    const info = await stat(path.join(root, next))
    if (info.size > 25 * 1024 * 1024) {
      console.log(`  · skipped (>25 MB): ${next}`)
      continue
    }
    found.push({ name: next, size: info.size })
  }
  return found
}

async function main() {
  console.log('\nCloud189 cold storage — snapshot of BODHA\'s local data\n' + '─'.repeat(64))

  const files = []
  for (const source of SOURCES) {
    const root = source.includes('/') ? path.dirname(source) : '.'
    const current = await collect(root, path.basename(source) === source && !source.includes('/') ? '' : path.basename(source), [])
    files.push(...current.map(f => ({ ...f, from: source })))
  }

  // A manifest is written next to the data so a restore is self-describing.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const total = files.reduce((sum, f) => sum + f.size, 0)
  console.log(`\n  ${files.length} file(s), ${(total / 1024).toFixed(0)} KB, from: ${SOURCES.join(', ') || '(nothing found)'}`)

  if (!SOURCES.length) {
    console.log('\n  Nothing to back up yet. In local (file-store) mode BODHA keeps its data in data/bodha/.\n')
    return
  }

  if (DRY) {
    console.log('\n  Dry run — nothing was uploaded. Files that WOULD go up:')
    for (const f of files.slice(0, 40)) console.log(`    ${f.from}/${f.name}  (${f.size} bytes)`)
    if (files.length > 40) console.log(`    … and ${files.length - 40} more`)
    console.log('\n  Run again with --yes to upload, after `cloud189 login-qr`.\n')
    return
  }

  // 1. Is the CLI present and logged in?
  const status = await cloud189(['status'])
  console.log(`\n  cloud189: ${status.slice(0, 200)}`)

  // 2. Pack the snapshot into a temporary file.
  const work = await mkdtemp(path.join(tmpdir(), 'bodha-cloud189-'))
  const manifest = {
    app: 'BODHA AI',
    takenAt: new Date().toISOString(),
    kind: 'local-snapshot',
    keep: KEEP,
    sources: SOURCES,
    files: files.map(f => ({ path: `${f.from}/${f.name}`, size: f.size })),
  }
  const pack = path.join(work, `bodha-${stamp}.json`)
  await writeFile(pack, JSON.stringify(manifest, null, 2))

  try {
    // 3. Upload the manifest, then every file, into /AgentStorage/backups/<stamp>/.
    const folderName = `bodha-${stamp}`
    let parent = FOLDER_ID
    if (!parent) {
      const mkdir = await cloud189(['mkdir', '0', 'AgentStorage'])
      parent = String(JSON.parse(mkdir)?.id ?? '').trim() || '0'
      const mkdirBackups = await cloud189(['mkdir', parent, 'backups'])
      parent = String(JSON.parse(mkdirBackups)?.id ?? parent).trim()
    }
    const mkdirRun = await cloud189(['mkdir', parent, folderName])
    const target = String(JSON.parse(mkdirRun)?.id ?? parent).trim()
    console.log(`  uploading to folder ${target} (${folderName})`)

    await cloud189(['upload', pack, target])
    let uploaded = 0
    for (const file of files) {
      const local = path.join(process.cwd(), file.from, file.name)
      if (!existsSync(local)) continue
      try {
        await cloud189(['upload', local, target])
        uploaded++
      } catch (err) {
        console.warn(`  ! ${file.from}/${file.name}: ${err.message}`)
      }
    }
    console.log(`\n  done — ${uploaded + 1} file(s) in AgentStorage/backups/${folderName} on Tianyi 189.`)
    console.log(`  Old snapshots are never deleted by this script; prune them with:\n    cloud189 list --json   →  cloud189 delete <fileId> --json\n`)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch(err => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
