/**
 * Reading the shelf: how BODHA finds the passages that answer a question.
 *
 * The corpus is a gzipped JSON file rather than a vector store because the
 * whole thing is small (about four megabytes) and it never changes while the
 * server is running. Two things happen once per process, lazily, on the first
 * question that needs them:
 *
 *   1. the file is read and parsed;
 *   2. an inverted index is built over every passage.
 *
 * After that a question costs a few milliseconds. There is no second service to
 * call, no embedding bill, and no way for the shelf to be unreachable — which
 * matters for a tutor that must answer even when a vendor is down.
 *
 * Ranking is BM25 with two Indian-Knowledge-Systems touches: the query is
 * widened with Sanskrit equivalents (a student asking about "duty" should reach
 * passages about dharma, and one asking about "moksha" should reach passages
 * about liberation), and naming a work lifts that work's passages.
 */

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { expandQuery, WORK_HINTS } from './glossary'

export interface Passage {
  id: string
  workId: string
  ref: string
  text: string
}

export interface Work {
  id: string
  title: string
  sanskrit?: string
  author: string
  translator: string
  edition: string
  year: number
  domain: string
  extent: string
  note: string
  sourceUrl: string
  license: string
  passages: number
  words: number
}

export interface Corpus {
  built: string
  digest?: string
  note: string
  works: Work[]
  passages: Passage[]
}

export interface Hit {
  passage: Passage
  work: Work
  score: number
}

/* ──────────────────────────────── loading ─────────────────────────────────── */

let corpusPromise: Promise<Corpus> | null = null

export function loadCorpus(): Promise<Corpus> {
  if (!corpusPromise) {
    corpusPromise = Promise.resolve().then(() => {
      // process.cwd() is the project root in dev and the function root on
      // Vercel; both hold src/data (see outputFileTracingIncludes in next.config).
      const file = path.join(process.cwd(), 'src/data/iks/corpus.json.gz')
      const corpus = JSON.parse(gunzipSync(readFileSync(file)).toString()) as Corpus

      // Repositories — databases and archives described in BODHA's own words
      // (TKDL and the like). They live in a small JSON file beside the corpus so
      // a rebuild of the primary texts never drops them.
      try {
        const extra = JSON.parse(readFileSync(path.join(process.cwd(), 'src/data/iks/repositories.json'), 'utf-8')) as {
          works: Array<Omit<Work, 'passages' | 'words'>>
          passages: Passage[]
        }
        for (const work of extra.works) {
          if (corpus.works.some(w => w.id === work.id)) continue
          const mine = extra.passages.filter(p => p.workId === work.id)
          corpus.works.push({ ...work, passages: mine.length, words: mine.reduce((n, p) => n + p.text.split(/\s+/).length, 0) })
          corpus.passages.push(...mine)
        }
      } catch (err) {
        console.warn('[iks] repositories not loaded:', (err as Error).message)
      }
      return corpus
    })
  }
  return corpusPromise
}

/* ─────────────────────────────── tokenising ───────────────────────────────── */

/**
 * Diacritics carry real meaning in Sanskrit transliteration (ś ≠ s in IAST as
 * scholars write it), but students type plain letters — and the archive scans
 * are inconsistent anyway — so both sides of a query are folded to plain ASCII
 * before they are compared.
 */
const FOLD: Record<string, string> = {
  ā: 'a', á: 'a', à: 'a', â: 'a', ä: 'a', å: 'a', ã: 'a',
  ī: 'i', í: 'i', ì: 'i', î: 'i', ï: 'i',
  ū: 'u', ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ṛ: 'r', ṝ: 'r', ḷ: 'l', ḹ: 'l',
  ṃ: 'm', ṁ: 'm', ñ: 'n', ṅ: 'n', ṇ: 'n', ṭ: 't', ḍ: 'd', ś: 's', ṣ: 's', ḥ: 'h', ẖ: 'h',
  ṣ́: 's', é: 'e', è: 'e', ê: 'e', ë: 'e', ó: 'o', ò: 'o', ô: 'o', ö: 'o', ç: 'c',
}

export function foldWord(word: string): string {
  let out = ''
  for (const ch of word.toLowerCase()) out += FOLD[ch] ?? ch
  return out
}

const STOPWORDS = new Set(`a an the and or but if then than that this these those of in on at to for from by with without about into over under
is are was were be been being am do does did doing have has had having will would shall should can could may might must
i me my we our you your he him his she her it its they them their what which who whom whose when where why how
not no nor so as also such very more most much many few some any all both each other another there here
tell explain about give show help please want need know does did doing explaination question answer`.split(/\s+/))

/** Light suffix stripping — enough to make "sacrifices" find "sacrifice". */
export function stem(word: string): string {
  let w = word
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  for (const suffix of ['ings', 'ing', 'edly', 'ed', 'es', 's']) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length)
      break
    }
  }
  if (w.length > 4 && (w.endsWith('ly') || w.endsWith('ness'))) w = w.replace(/(ly|ness)$/, '')
  return w
}

export function tokenize(text: string, { keepStopwords = false } = {}): string[] {
  const words = foldWord(text).split(/[^a-z0-9]+/i).filter(Boolean)
  const terms: string[] = []
  for (const word of words) {
    if (word.length < 2 || /^\d+$/.test(word)) continue
    if (!keepStopwords && STOPWORDS.has(word)) continue
    terms.push(stem(word))
  }
  return terms
}

/* ─────────────────────────────── the index ────────────────────────────────── */

interface Index {
  corpus: Corpus
  worksById: Map<string, Work>
  /** term → flat [docId, termFrequency, docId, termFrequency, …] */
  postings: Map<string, number[]>
  lengths: number[]
  averageLength: number
}

let indexPromise: Promise<Index> | null = null

export function loadIndex(): Promise<Index> {
  if (!indexPromise) {
    indexPromise = loadCorpus().then(corpus => {
      const postings = new Map<string, number[]>()
      const lengths = new Array<number>(corpus.passages.length)

      corpus.passages.forEach((passage, docId) => {
        const counts = new Map<string, number>()
        // The reference line is indexed too, so "chapter 4" finds chapter four.
        for (const term of tokenize(`${passage.ref} ${passage.text}`)) {
          counts.set(term, (counts.get(term) ?? 0) + 1)
        }
        let length = 0
        for (const [term, count] of counts) {
          length += count
          const list = postings.get(term)
          if (list) list.push(docId, count)
          else postings.set(term, [docId, count])
        }
        lengths[docId] = length
      })

      const total = lengths.reduce((sum, n) => sum + n, 0)
      return {
        corpus,
        worksById: new Map(corpus.works.map(work => [work.id, work])),
        postings,
        lengths,
        averageLength: total / Math.max(1, lengths.length),
      }
    })
  }
  return indexPromise
}

/* ──────────────────────────────── searching ───────────────────────────────── */

const K1 = 1.2
const B = 0.75

export interface SearchOptions {
  /** How many passages to return at most. */
  limit?: number
  /** Drop hits scoring below this share of the best hit. */
  keepShare?: number
}

/**
 * Finds the passages that best answer `question`.
 *
 * Returns [] when nothing matches, which callers treat as "the shelf has
 * nothing to say here" rather than padding the prompt with irrelevant text.
 */
export async function searchShelf(question: string, opts: SearchOptions = {}): Promise<Hit[]> {
  const limit = opts.limit ?? 5
  const keepShare = opts.keepShare ?? 0.35
  const index = await loadIndex()
  const { corpus, postings, lengths, averageLength, worksById } = index

  const base = tokenize(question)
  if (!base.length) return []

  // Weighted query terms: what the student typed counts fully; Sanskrit
  // equivalents and loose variants count a little less.
  const weights = new Map<string, number>()
  for (const term of base) weights.set(term, 1)
  for (const [term, weight] of expandQuery(base)) {
    weights.set(term, Math.max(weights.get(term) ?? 0, weight))
  }

  // A question that names a work should answer from that work first.
  const questionFolded = ` ${foldWord(question)} `
  const workBoost = new Set<string>()
  for (const [workId, hints] of Object.entries(WORK_HINTS)) {
    if (hints.some(hint => questionFolded.includes(` ${hint} `))) workBoost.add(workId)
  }

  const scores = new Map<number, number>()
  const docCount = corpus.passages.length

  for (const [term, weight] of weights) {
    const list = postings.get(term)
    if (!list) continue
    const df = list.length / 2
    // Standard BM25 idf, floored so a very common term can still matter a little.
    const idf = Math.max(0.1, Math.log(1 + (docCount - df + 0.5) / (df + 0.5)))
    for (let i = 0; i < list.length; i += 2) {
      const docId = list[i]
      const tf = list[i + 1]
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (lengths[docId] / averageLength)))
      scores.set(docId, (scores.get(docId) ?? 0) + weight * idf * norm)
    }
  }

  if (!scores.size) return []

  const ranked = [...scores.entries()]
    .map(([docId, score]) => {
      const passage = corpus.passages[docId]
      const work = worksById.get(passage.workId)
      const lifted = score * (workBoost.has(passage.workId) ? 1.7 : 1)
      return { passage, work, score: lifted }
    })
    .filter((hit): hit is Hit => Boolean(hit.work))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0].score
  const floor = best * keepShare
  const kept = ranked.filter(hit => hit.score >= floor).slice(0, limit)

  // Two passages from the same place read as padding; keep the best one only.
  const seen = new Set<string>()
  return kept.filter(hit => {
    const key = `${hit.passage.workId}:${hit.passage.ref}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The shelf, as shown to a student — works in a reading order, not alphabetical. */
export async function listWorks(): Promise<Work[]> {
  const corpus = await loadCorpus()
  return corpus.works
}

export async function corpusStats(): Promise<{ works: number; passages: number; words: number; built: string }> {
  const corpus = await loadCorpus()
  return {
    works: corpus.works.length,
    passages: corpus.passages.length,
    words: corpus.works.reduce((sum, work) => sum + work.words, 0),
    built: corpus.built,
  }
}
