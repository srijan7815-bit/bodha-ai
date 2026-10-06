/**
 * Indian Knowledge Systems — the shelf behind every answer.
 *
 * BODHA answers from two kinds of ground: the documents a student uploads, and
 * this collection of primary Indian works — the Vedas and Upanishads, the two
 * epics, the Bhagavad Gita, the philosophical systems, law, statecraft,
 * medicine, mathematics and astronomy, in public-domain English translations.
 *
 * Only the passages that actually answer the question are quoted, and every one
 * of them is attributed. When nothing on the shelf is close enough, nothing is
 * added: a made-up citation would be worse than no citation.
 */

import { searchShelf, type Hit, type Passage, type Work } from './corpus'

export { listWorks, corpusStats, loadCorpus } from './corpus'
export type { Hit, Passage, Work } from './corpus'

/** A citation as the browser sees it — small enough to keep on a message. */
export interface SourceRef {
  id: string
  workId: string
  title: string
  ref: string
  translator: string
  year: number
  sourceUrl: string
  /** The quoted passage, so the student can read what the answer leaned on. */
  excerpt: string
}

/** How many passages BODHA may quote in one answer. */
const MAX_SOURCES = 4

export function toSourceRef(hit: Hit, index: number): SourceRef {
  return {
    id: String(index + 1),
    workId: hit.work.id,
    title: hit.work.title,
    ref: hit.passage.ref,
    translator: hit.work.translator,
    year: hit.work.year,
    sourceUrl: hit.work.sourceUrl,
    excerpt: hit.passage.text.length > 700 ? `${hit.passage.text.slice(0, 700).trim()}…` : hit.passage.text,
  }
}

export interface Retrieved {
  sources: SourceRef[]
  /** The prompt block, ready to append to the system message. */
  context: string | null
}

/**
 * Reads the shelf for one question.
 *
 * `question` should be the student's own words: the last thing they typed. A
 * question that reads like a greeting, or one about the student's own uploaded
 * document, usually retrieves nothing — which is correct behaviour, not a
 * failure.
 */
export async function retrieveForQuestion(question: string): Promise<Retrieved> {
  const trimmed = question.trim()
  if (trimmed.length < 4) return { sources: [], context: null }

  let hits: Hit[] = []
  try {
    hits = await searchShelf(trimmed, { limit: MAX_SOURCES })
  } catch (err) {
    // The shelf must never be the reason a lesson fails to arrive.
    console.warn('[iks] retrieval failed:', (err as Error).message)
    return { sources: [], context: null }
  }
  if (!hits.length) return { sources: [], context: null }

  const sources = hits.map(toSourceRef)
  const lines = hits.map((hit, index) => {
    const src = sources[index]
    return `[${src.id}] ${hit.work.title}${hit.work.sanskrit ? ` (${hit.work.sanskrit})` : ''} — ${src.ref}\n` +
      `Translated by ${hit.work.translator} (${hit.work.year}). ${hit.work.domain}.\n${hit.passage.text}`
  })

  return {
    sources,
    context:
      'Passages from the Indian Knowledge Systems shelf, retrieved for this question. ' +
      'They are quotations from public-domain translations, not from the student.\n\n' +
      '--- BEGIN PASSAGES ---\n' +
      lines.join('\n\n') +
      '\n--- END PASSAGES ---',
  }
}
