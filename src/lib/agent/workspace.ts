/**
 * BODHA's computer: a private working folder plus a small set of tools.
 *
 * Every run gets its own empty directory; the agent can write, read, download
 * and generate files there and nowhere else. It cannot run arbitrary programs —
 * the tools are fixed — so the blast radius of a confused or manipulated model
 * is one temporary folder.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import * as XLSX from 'xlsx'
import { Sandbox } from '@e2b/code-interpreter'
import { githubTargets, htmlToText, readGithub, readPage, researchWeb, safeFetch, webSearch } from '../web'
import { MIME, mimeOf } from '../workspace/mime'
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  WS_MAX_FILE,
  WS_MAX_FILES,
  WS_MAX_TOTAL,
} from '../workspace/store'

const MAX_FILE = WS_MAX_FILE
const MAX_TOTAL = WS_MAX_TOTAL
const MAX_FILES = WS_MAX_FILES

export type Block = string | { type?: 'h1' | 'h2' | 'p' | 'li'; text: string }

export { MIME }

export class Workspace {
  readonly dir: string
  private total = 0
  private box: Sandbox | null = null
  /** The student this workspace belongs to; null for an anonymous, throwaway run. */
  private ownerId: string | null = null
  /** Files that exist in the student's cloud workspace but have no local copy. */
  private remote = new Map<string, number>()
  /** Files written in this run that still have to be saved back to the cloud. */
  private dirty = new Set<string>()

  private constructor(dir: string) {
    this.dir = dir
  }

  /**
   * A fresh working directory for one run — hydrated with the student's saved files
   * when an owner is given, so a task can continue yesterday's work.
   */
  static async create(options: { ownerId?: string | null } = {}): Promise<Workspace> {
    const dir = path.join(tmpdir(), 'bodha-agent', randomUUID())
    await fs.mkdir(dir, { recursive: true })
    const ws = new Workspace(dir)
    if (options.ownerId) {
      ws.ownerId = options.ownerId
      // Best-effort: a storage hiccup must never stop a task from running.
      await ws.hydrate().catch(err => console.warn('[workspace] could not load saved files:', (err as Error).message))
    }
    return ws
  }

  /** Pulls the student's saved files into this run's working directory. */
  private async hydrate(): Promise<void> {
    if (!this.ownerId) return
    const files = await listWorkspaceFiles(this.ownerId)
    for (const f of files) {
      this.remote.set(f.name, f.size)
      this.total += f.size
    }
    // Only the reasonably sized files are copied eagerly; anything larger is
    // fetched on demand by read(), so starting a task stays fast.
    let budget = MAX_TOTAL
    await Promise.all(
      files
        .filter(f => f.size <= 3 * 1024 * 1024)
        .slice(0, MAX_FILES)
        .map(async f => {
          if (budget <= 0) return
          const got = await readWorkspaceFile(this.ownerId!, f.name).catch(() => null)
          if (!got) return
          budget -= got.bytes.length
          const target = path.join(this.dir, f.name)
          await fs.mkdir(path.dirname(target), { recursive: true })
          await fs.writeFile(target, got.bytes)
        }),
    )
  }

  /** Whether an isolated computer (E2B) is available for running code. */
  static get hasComputer(): boolean {
    return Boolean(process.env.E2B_API_KEY?.trim())
  }

  private static readonly REMOTE = '/home/user/work'

  private async computer(): Promise<Sandbox> {
    if (!Workspace.hasComputer) throw new Error('no computer is connected (E2B_API_KEY is not set)')
    if (!this.box) this.box = await Sandbox.create({ apiKey: process.env.E2B_API_KEY!.trim(), timeoutMs: 180_000 })
    return this.box
  }

  /** Copy the workspace into the computer, run something, copy new/changed files back. */
  /**
   * Runs something on the computer. Anything the run changes comes back into the
   * workspace, and is marked dirty so it is saved to the student's cloud workspace.
   */
  private async onComputer(run: (box: Sandbox) => Promise<string>): Promise<string> {
    const box = await this.computer()
    const local = await this.list()
    for (const f of local) {
      const bytes = await fs.readFile(path.join(this.dir, f.name))
      await box.files.write(`${Workspace.REMOTE}/${f.name}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    }
    const known = new Map(local.map(f => [f.name, f.size]))
    const output = await run(box)

    const changed: string[] = []
    const walk = async (remote: string, rel: string, depth: number) => {
      for (const entry of await box.files.list(remote)) {
        const next = rel ? `${rel}/${entry.name}` : entry.name
        if (String(entry.type) === 'dir') {
          if (depth < 3 && !/^(\.|__pycache__|node_modules)/.test(entry.name)) await walk(`${remote}/${entry.name}`, next, depth + 1)
        } else if (entry.size <= MAX_FILE && known.get(next) !== entry.size && changed.length < 10) {
          try {
            const bytes = await box.files.read(`${remote}/${entry.name}`, { format: 'bytes' })
            await this.save(next, Buffer.from(bytes))
            changed.push(next)
          } catch {
            /* a file that cannot be copied back is skipped */
          }
        }
      }
    }
    await walk(Workspace.REMOTE, '', 0).catch(() => {})
    return `${output}${changed.length ? `\n[files saved to the workspace: ${changed.join(', ')}]` : ''}`.slice(0, 4000)
  }

  async destroy() {
    // Save first: the run is over, so nothing may be lost with the folder.
    await this.flush().catch(() => {})
    await this.box?.kill().catch(() => {})
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {})
  }

  /* ─────────────────── persistence (the student's workspace) ─────────────────── */

  /**
   * Writes everything this run changed back to the student's workspace, in parallel.
   * Called once before the run hands its files over — so a task's results are always
   * there afterwards, even if the browser tab is closed on the spot.
   */
  async flush(): Promise<string[]> {
    if (!this.ownerId || !this.dirty.size) return []
    const owner = this.ownerId
    const names = [...this.dirty]
    this.dirty.clear()
    const saved: string[] = []
    await Promise.all(
      names.map(async name => {
        try {
          const bytes = await fs.readFile(path.join(this.dir, name))
          await writeWorkspaceFile(owner, name, bytes)
          this.remote.set(name, bytes.length)
          saved.push(name)
        } catch (err) {
          this.dirty.add(name)
          console.warn('[workspace] could not save', name, '-', (err as Error).message)
        }
      }),
    )
    return saved
  }

  /** Deletes a file from this run and from the student's saved workspace. */
  async remove(name: string): Promise<void> {
    const clean = path.posix.normalize(String(name || '').replace(/\\/g, '/')).replace(/^\/+/, '')
    await fs.rm(path.join(this.dir, clean), { force: true }).catch(() => {})
    this.dirty.delete(clean)
    this.remote.delete(clean)
    if (this.ownerId) await deleteWorkspaceFile(this.ownerId, clean).catch(() => {})
  }

  /** Saves one file immediately (used when the student edits from the UI). */
  async persist(name: string): Promise<boolean> {
    if (!this.ownerId) return false
    const clean = path.posix.normalize(String(name || '').replace(/\\/g, '/')).replace(/^\/+/, '')
    try {
      const bytes = await fs.readFile(path.join(this.dir, clean))
      await writeWorkspaceFile(this.ownerId, clean, bytes)
      this.dirty.delete(clean)
      this.remote.set(clean, bytes.length)
      return true
    } catch {
      return false
    }
  }

  /** A path the agent names → a safe absolute path inside the workspace. */
  private resolve(name: string): string {
    const clean = path.posix
      .normalize(String(name || '').replace(/\\/g, '/'))
      .replace(/^\/+/, '')
      .replace(/^(\.\.\/)+/, '')
    if (!clean || clean === '.' || clean.includes('..') || clean.split('/').length > 4 || clean.length > 120 || !/^[\w\u0900-\u097F .\-/()]+$/.test(clean)) {
      throw new Error(`"${name}" is not a usable file name (use simple names like report.pdf or notes/day1.md)`)
    }
    return path.join(this.dir, clean)
  }

  private async save(name: string, bytes: Buffer | string): Promise<string> {
    const data = typeof bytes === 'string' ? Buffer.from(bytes, 'utf-8') : bytes
    if (data.length > MAX_FILE) throw new Error('that file is larger than 5 MB')
    if (this.total + data.length > MAX_TOTAL) throw new Error('the workspace is full (12 MB)')
    const files = await this.list()
    const target = this.resolve(name)
    if (files.length >= MAX_FILES && !files.some(f => path.join(this.dir, f.name) === target)) throw new Error('too many files in the workspace')
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, data)
    this.total += data.length
    const rel = path.relative(this.dir, target).replace(/\\/g, '/')
    if (this.ownerId) this.dirty.add(rel)
    return `${rel} (${data.length} bytes)`
  }

  async list(): Promise<Array<{ name: string; size: number }>> {
    const out: Array<{ name: string; size: number }> = []
    const walk = async (rel: string) => {
      for (const entry of await fs.readdir(path.join(this.dir, rel), { withFileTypes: true })) {
        const next = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(next)
        else out.push({ name: next, size: (await fs.stat(path.join(this.dir, next))).size })
      }
    }
    await walk('')
    // Files the student saved earlier that this run has not had to open yet.
    for (const [name, size] of this.remote) {
      if (!out.some(f => f.name === name)) out.push({ name, size })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async read(name: string): Promise<{ name: string; mime: string; size: number; bytes: Buffer } | null> {
    try {
      const file = this.resolve(name)
      const bytes = await fs.readFile(file)
      return { name: path.relative(this.dir, file).replace(/\\/g, '/'), mime: mimeOf(file), size: bytes.length, bytes }
    } catch {
      // Not on disk yet — it may be one of the student's saved files. Fetch it once.
      const clean = path.posix.normalize(String(name || '').replace(/\\/g, '/')).replace(/^\/+/, '')
      if (!this.ownerId || !this.remote.has(clean)) return null
      const got = await readWorkspaceFile(this.ownerId, clean).catch(() => null)
      if (!got) return null
      try {
        const target = path.join(this.dir, clean)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, got.bytes)
      } catch {
        /* still return the bytes even if the cache write failed */
      }
      return { name: clean, mime: mimeOf(clean), size: got.bytes.length, bytes: got.bytes }
    }
  }

  /* ─────────────────────────────── tools ─────────────────────────────── */

  async run(tool: string, a: Record<string, unknown>): Promise<string> {
    switch (tool) {
      case 'write_file':
        return `saved ${await this.save(String(a.path), String(a.content ?? ''))}`
      case 'read_file': {
        const f = await this.read(String(a.path))
        if (!f) throw new Error('no such file')
        return /^(text\/|application\/json)/.test(f.mime) ? f.bytes.toString('utf-8').slice(0, 6000) : `${f.name}: binary file, ${f.size} bytes`
      }
      case 'list_files': {
        const files = await this.list()
        return files.length ? files.map(f => `${f.name} (${f.size} bytes)`).join('\n') : '(the workspace is empty)'
      }
      case 'download': {
        const res = await safeFetch(String(a.url), { headers: { 'User-Agent': 'BODHA-AI/1.0' }, timeoutMs: 15_000 })
        if (!res.ok) throw new Error(`the server answered HTTP ${res.status}`)
        const bytes = Buffer.from(await res.arrayBuffer())
        const fallback = new URL(String(a.url)).pathname.split('/').filter(Boolean).pop() || 'download.bin'
        return `downloaded and saved ${await this.save(String(a.path || fallback), bytes)}`
      }
      case 'read_url': {
        const page = await readPage(String(a.url))
        if (!page) throw new Error('could not read that page')
        return page.text.slice(0, 5000)
      }
      case 'search_web': {
        const results = await webSearch(String(a.query))
        if (!results.length) throw new Error('the search returned nothing')
        return results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${r.snippet}`).join('\n')
      }
      case 'research': {
        // The deep path: Agenta's stored research agent reads several sources and
        // writes a sourced note. Slow, so it fails soft and the fast search above
        // is still there as the fallback.
        const found = await researchWeb(String(a.query), { deadlineMs: 60_000 })
        if (!found) throw new Error('the research agent did not answer — use search_web instead')
        return `${found.text}${found.sources.length ? `\n\nSources: ${found.sources.join(', ')}` : ''}`.slice(0, 6_000)
      }
      case 'github': {
        const target = githubTargets(String(a.target).includes('github.com') ? String(a.target) : `github ${a.target}`)[0]
        const text = target ? await readGithub(target) : null
        if (!text) throw new Error('could not read that GitHub address')
        return text.slice(0, 5000)
      }
      case 'run_python': {
        const code = String(a.code ?? '').slice(0, 20_000)
        if (!code.trim()) throw new Error('"code" is empty')
        return this.onComputer(async box => {
          const exec = await box.runCode(`import os\nos.makedirs('${Workspace.REMOTE}', exist_ok=True)\nos.chdir('${Workspace.REMOTE}')\n${code}`, { timeoutMs: 60_000 })
          const out = [exec.logs.stdout.join(''), exec.logs.stderr.join(''), exec.text ? `=> ${exec.text}` : ''].filter(Boolean).join('\n')
          if (exec.error) throw new Error(`${exec.error.name}: ${exec.error.value}\n${out}`.slice(0, 1500))
          return out || '(finished, no output)'
        })
      }
      case 'run_shell': {
        const command = String(a.command ?? '').slice(0, 2_000)
        if (!command.trim()) throw new Error('"command" is empty')
        return this.onComputer(async box => {
          try {
            const r = await box.commands.run(command, { cwd: Workspace.REMOTE, timeoutMs: 60_000 })
            return [r.stdout, r.stderr].filter(Boolean).join('\n') || '(finished, no output)'
          } catch (err) {
            const e = err as { stdout?: string; stderr?: string; exitCode?: number; message?: string }
            throw new Error(`exit ${e.exitCode ?? '?'}: ${[e.stdout, e.stderr, e.message].filter(Boolean).join('\n')}`.slice(0, 1500))
          }
        })
      }
      case 'make_pdf':
        return `created ${await this.save(String(a.path), await makePdf(String(a.title ?? ''), asBlocks(a.blocks)))}`
      case 'make_docx':
        return `created ${await this.save(String(a.path), await makeDocx(String(a.title ?? ''), asBlocks(a.blocks)))}`
      case 'make_xlsx':
        return `created ${await this.save(String(a.path), makeXlsx(a.sheets))}`
      default:
        throw new Error(`unknown tool "${tool}"`)
    }
  }
}

/* ─────────────────────────────── generators ─────────────────────────────── */

function asBlocks(raw: unknown): Block[] {
  if (typeof raw === 'string') return raw.split(/\n{2,}/).map(text => text.trim()).filter(Boolean)
  if (!Array.isArray(raw)) throw new Error('"blocks" must be a list of paragraphs or {type, text} objects')
  return raw.slice(0, 400) as Block[]
}

const norm = (b: Block): { type: 'h1' | 'h2' | 'p' | 'li'; text: string } =>
  typeof b === 'string' ? { type: 'p', text: b } : { type: b.type ?? 'p', text: String(b.text ?? '') }

async function makeDocx(title: string, blocks: Block[]): Promise<Buffer> {
  const children: Paragraph[] = []
  if (title) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }))
  for (const raw of blocks) {
    const b = norm(raw)
    if (b.type === 'h1') children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(b.text)] }))
    else if (b.type === 'h2') children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.text)] }))
    else if (b.type === 'li') children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b.text)] }))
    else children.push(new Paragraph({ spacing: { after: 140 }, children: [new TextRun(b.text)] }))
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }))
}

function makeXlsx(raw: unknown): Buffer {
  const sheets = Array.isArray(raw) ? (raw as Array<{ name?: string; rows?: unknown[][] }>) : []
  if (!sheets.length) throw new Error('"sheets" must be a list like [{"name":"Plan","rows":[["Day","Topic"],["Mon","Algebra"]]}]')
  const book = XLSX.utils.book_new()
  sheets.slice(0, 8).forEach((s, i) => {
    const rows = (s.rows ?? []).slice(0, 2000).map(r => (Array.isArray(r) ? r.map(v => (typeof v === 'number' || typeof v === 'boolean' ? v : String(v ?? ''))) : [String(r)]))
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  })
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
}

async function makePdf(title: string, blocks: Block[]): Promise<Buffer> {
  const all = [title, ...blocks.map(b => norm(b).text)].join(' ')
  if ((all.match(/[\u0900-\u097F]/g)?.length ?? 0) > 3) {
    throw new Error('PDF files here cannot hold Devanagari text — use make_docx (or an .html file) for Hindi')
  }
  const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, c => (c === '’' || c === '‘' ? "'" : c === '“' || c === '”' ? '"' : c === '–' || c === '—' ? '-' : c === '…' ? '...' : '?'))
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const W = 595, H = 842, M = 56
  let page = pdf.addPage([W, H])
  let y = H - M
  const line = (text: string, size: number, font = regular, indent = 0, gap = 4) => {
    const words = safe(text).split(/\s+/)
    let cur = ''
    const flush = () => {
      if (y < M + size) { page = pdf.addPage([W, H]); y = H - M }
      page.drawText(cur, { x: M + indent, y: y - size, size, font, color: rgb(0.1, 0.1, 0.1) })
      y -= size + gap
      cur = ''
    }
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (font.widthOfTextAtSize(next, size) > W - 2 * M - indent && cur) { flush(); cur = w } else cur = next
    }
    if (cur) flush()
  }
  if (title) { line(title, 22, bold, 0, 10); y -= 6 }
  for (const raw of blocks) {
    const b = norm(raw)
    if (b.type === 'h1') { y -= 8; line(b.text, 16, bold, 0, 6) }
    else if (b.type === 'h2') { y -= 4; line(b.text, 13, bold, 0, 5) }
    else if (b.type === 'li') line(`- ${b.text}`, 11, regular, 12, 4)
    else { line(b.text, 11, regular, 0, 4); y -= 5 }
  }
  return Buffer.from(await pdf.save())
}

export { htmlToText }
