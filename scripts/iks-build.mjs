/**
 * Builds BODHA's Indian Knowledge Systems corpus.
 *
 * Every text here is a public-domain English translation of a primary Indian
 * work — Project Gutenberg editions where a single clean file exists, and the
 * Internet Archive's full-text scans for the scholarly ones (SBE volumes, the
 * Colebrooke algebra, Bhishagratna's Sushruta). Nothing is generated, nothing
 * is paraphrased: retrieval quotes the translator's own words, and each passage
 * carries the work, the translator, the year, the reference (chapter / verse /
 * section) and a link to the source.
 *
 * Run:  node scripts/iks-build.mjs        (writes src/data/iks/corpus.json.gz)
 *       node scripts/iks-build.mjs --check (prints what is already built)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const OUT_DIR = 'src/data/iks'
const OUT_FILE = `${OUT_DIR}/corpus.json.gz`

/** Target size of one passage, in words. Big enough to answer from, small enough to quote. */
const PASSAGE_WORDS = 190
/** Per-work ceiling, so one enormous epic cannot crowd out the rest of the shelf. */
const WORK_WORD_CAP = 120_000

/* ─────────────────────────────── the shelf ───────────────────────────────── */

const GUTENBERG = [
  {
    id: 'gita',
    title: 'Bhagavad Gita',
    sanskrit: 'भगवद्गीता',
    author: 'Vyasa (attributed)',
    translator: 'Sir Edwin Arnold',
    edition: 'The Song Celestial (1885)',
    year: 1885,
    domain: 'Itihasa — philosophy',
    extent: 'complete',
    note: 'The dialogue between Arjuna and Krishna on duty, action and liberation, in Arnold’s verse.',
    pg: 2388,
  },
  {
    id: 'upanishads',
    title: 'The Upanishads',
    sanskrit: 'उपनिषद्',
    author: 'Ancient seers',
    translator: 'Charles Johnston',
    edition: 'The Upanishads (1907)',
    year: 1907,
    domain: 'Shruti — Vedanta',
    extent: 'selections',
    note: 'The close of the Veda: the self, the absolute, and the path of knowledge.',
    pg: 3283,
  },
  {
    id: 'yoga-sutras',
    title: 'Yoga Sutras of Patanjali',
    sanskrit: 'योगसूत्र',
    author: 'Patanjali',
    translator: 'Charles Johnston',
    edition: 'The Book of the Spiritual Man (1912)',
    year: 1912,
    domain: 'Darshana — Yoga',
    extent: 'complete',
    note: 'The aphorisms on discipline of mind: attention, practice, and the stilling of thought.',
    pg: 2526,
  },
  {
    id: 'vedanta-sutras',
    title: 'Vedanta Sutras with Shankara’s commentary',
    sanskrit: 'ब्रह्मसूत्र',
    author: 'Badarayana',
    translator: 'George Thibaut',
    edition: 'Sacred Books of the East 34 & 38 (1890–1904)',
    year: 1904,
    domain: 'Darshana — Vedanta',
    extent: 'complete',
    note: 'The Brahma Sutras with the Advaita commentary of Adi Shankara.',
    pg: 16295,
  },
  {
    id: 'ramayana',
    title: 'Ramayana',
    sanskrit: 'रामायण',
    author: 'Valmiki',
    translator: 'Ralph T. H. Griffith',
    edition: 'The Rámáyan of Válmíki (1870–74)',
    year: 1874,
    domain: 'Itihasa — epic',
    extent: 'complete',
    note: 'The epic of Rama: dharma in family, rule and exile, in verse.',
    pg: 24869,
  },
  {
    id: 'mahabharata',
    title: 'Mahabharata (Book I)',
    sanskrit: 'महाभारत',
    author: 'Vyasa (attributed)',
    translator: 'Kisari Mohan Ganguli',
    edition: 'The Mahabharata of Krishna-Dwaipayana Vyasa, Vol. I (1883–96)',
    year: 1896,
    domain: 'Itihasa — epic',
    extent: 'Adi Parva',
    note: 'The first book of the epic: origins, the house of Bharata, and the seeds of the war.',
    pg: 15474,
  },
  {
    id: 'hitopadesha',
    title: 'Hitopadesha & Hindu literature',
    sanskrit: 'हितोपदेश',
    author: 'Narayana (attributed)',
    translator: 'Sir Edwin Arnold et al.',
    edition: 'Hindu Literature (1900)',
    year: 1900,
    domain: 'Niti — counsel',
    extent: 'complete',
    note: 'The Book of Good Counsels (Hitopadesha) with Nala, Sakoontala and the epic in brief.',
    pg: 13268,
  },
]

const ARCHIVE = [
  {
    id: 'sarvadarsana',
    title: 'Sarva-Darshana-Samgraha',
    sanskrit: 'सर्वदर्शनसंग्रह',
    author: 'Madhavacharya',
    translator: 'E. B. Cowell & A. E. Gough',
    edition: 'Review of the Six Systems (1882)',
    year: 1882,
    domain: 'Darshana — all systems',
    extent: 'complete',
    note: 'A tour of every Indian school of thought: Nyaya, Vaisheshika, Sankhya, Yoga, Mimamsa, Vedanta, Buddhist and Jaina.',
    item: 'thesarvadarsanas00madhuoft',
  },
  {
    id: 'manu',
    title: 'Laws of Manu',
    sanskrit: 'मनुस्मृति',
    author: 'Manu (attributed)',
    translator: 'George Bühler',
    edition: 'Sacred Books of the East 25 (1886)',
    year: 1886,
    domain: 'Smriti — law',
    extent: 'complete',
    note: 'The classic text on social duty, law and the ordering of life.',
    item: 'mlbd.lawsofmanu0025unse_h6b1',
  },
  {
    id: 'arthashastra',
    title: 'Arthashastra',
    sanskrit: 'अर्थशास्त्र',
    author: 'Kautilya (Chanakya)',
    translator: 'R. Shamasastry',
    edition: 'Kautilya’s Arthasastra (1915)',
    year: 1915,
    domain: 'Shastra — statecraft & economy',
    extent: 'complete',
    note: 'The science of state, economy, administration and diplomacy.',
    item: 'in.ernet.dli.2015.70130',
    altItems: ['in.gov.ignca.900', 'dli.ernet.24260'],
  },
  {
    id: 'rigveda',
    title: 'Hymns of the Rigveda',
    sanskrit: 'ऋग्वेद',
    author: 'Ancient seers',
    translator: 'Ralph T. H. Griffith',
    edition: 'The Hymns of the Rigveda (1889)',
    year: 1889,
    domain: 'Shruti — Veda',
    extent: 'Volume I',
    note: 'The oldest hymns: praise of the elements, of dawn, of speech and of the one reality.',
    item: 'in.ernet.dli.2015.284070',
  },
  {
    id: 'surya-siddhanta',
    title: 'Surya Siddhanta',
    sanskrit: 'सूर्यसिद्धान्त',
    author: 'Anonymous school (attributed to Surya)',
    translator: 'Ebenezer Burgess',
    edition: 'Translation of the Sûrya-Siddhânta, a Text-book of Hindu Astronomy (1860)',
    year: 1860,
    domain: 'Vedanga — Jyotisha (astronomy)',
    extent: 'complete',
    note: 'Indian astronomy and time reckoning: planetary motion, eclipses, calendars.',
    item: 'jstor-592174',
    altItems: ['in.ernet.dli.2015.92923', 'india.history.resource.106908'],
  },
  {
    id: 'lilavati',
    title: 'Algebra, Arithmetic and Mensuration — Brahmagupta & Bhaskara',
    sanskrit: 'लीलावती / ब्राह्मस्फुटसिद्धान्त',
    author: 'Brahmagupta & Bhaskara II',
    translator: 'Henry Thomas Colebrooke',
    edition: 'From the Sanscrit of Brahmegupta and Bháscara (1817)',
    year: 1817,
    domain: 'Vedanga — Ganita (mathematics)',
    extent: 'complete',
    note: 'Indian arithmetic, algebra and geometry, including the rules of zero, negative numbers and the “pulveriser”.',
    item: 'algebrawitharith00brahuoft',
  },
  {
    id: 'thirukkural',
    title: 'Thirukkural',
    sanskrit: 'திருக்குறள்',
    author: 'Thiruvalluvar',
    translator: 'G. U. Pope',
    edition: 'The Sacred Kurral of Tiruvalluva Nayanar (1886)',
    year: 1886,
    domain: 'Niti — Tamil ethics',
    extent: 'complete',
    note: 'Tamil couplets on virtue, wealth and love — the ethics text of the south.',
    item: 'tiruvalluvanayan00tiruuoft',
  },
  {
    id: 'sushruta',
    title: 'Sushruta Samhita',
    sanskrit: 'सुश्रुतसंहिता',
    author: 'Sushruta',
    translator: 'Kaviraj Kunja Lal Bhishagratna',
    edition: 'An English Translation of the Sushruta Samhita (1907)',
    year: 1907,
    domain: 'Upaveda — Ayurveda (medicine)',
    extent: 'Volume I',
    note: 'Surgery and medicine: diagnosis, treatment, instruments and the training of a physician.',
    item: 'englishtranslati00susruoft',
  },
]

/* ─────────────────────────────── clean-up ────────────────────────────────── */

const NOISE = [
  /^\s*\d{1,4}\s*$/, // bare page numbers
  /^\s*[ivxlcdm]{1,9}\s*$/i, // bare roman numerals
  /project gutenberg/i,
  /^\s*\*\*\*\s*(start|end) of/i,
  /digitized by/i,
  /^https?:\/\//i,
  /^\s*generated (on|by)\s/i,
  /^\s*page\s+\d+\s*$/i,
  /^\s*f\s*\.\s*\d+\s*$/i, // scan artefacts such as "f. 32"
  /^\s*[\[\]{}<>|_~^*=+·•—–-]{3,}\s*$/, // rules and dividers
  /copyright (notice|law)/i,
  /^\s*(transcriber|proofreader|editor)'?s? note/i,
  /electronic(ally)? (text|version)/i,
]

function clean(raw, { archive = false } = {}) {
  let text = raw.replace(/\r\n?/g, '\n')
  // Project Gutenberg wraps the work in licence boilerplate; keep only the work.
  const start = text.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i)
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1)
  const end = text.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i)
  if (end >= 0) text = text.slice(0, end)

  const lines = text.split('\n')
  const kept = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      kept.push('')
      continue
    }
    if (NOISE.some(re => re.test(trimmed))) continue
    // Internet Archive scans carry running heads: a title repeated every page.
    if (archive && trimmed.length < 62 && /^[A-Z0-9 ,.'’·:;—&()\-]+$/.test(trimmed) && /^[A-Z ,'’·:;—&()\-]+$/.test(trimmed) && trimmed === trimmed.toUpperCase() && trimmed.split(' ').length <= 6) continue
    kept.push(trimmed.replace(/[ \t]{2,}/g, ' '))
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Chapter / canto / hymn / book headings, so every passage can say where it is from. */
const HEADINGS = [
  /^(?:BOOK|CANTO|CHAPTER|CHAP\.|SECTION|PART|ADHYAYA|ADHYĀYA|HYMN|MANDALA|MANDALA|PRAKARANA|PARVA|DISCOURSE|LECTURE)\b[ .,:]*(.{0,90})$/i,
  /^(?:[IVXL]{1,7})\.\s+(.{3,90})$/,
  /^(\d{1,3})\.\s+[A-Z].{0,80}$/,
]

function headingOf(line) {
  const trimmed = line.trim().replace(/[.:]+$/, '')
  if (trimmed.length > 110 || trimmed.length < 3) return null
  for (const re of HEADINGS) {
    const m = trimmed.match(re)
    if (m) return trimmed.replace(/\s{2,}/g, ' ').slice(0, 96)
  }
  return null
}

/**
 * Is this passage actually readable English?
 *
 * The Archive scans bring along their own noise: Tamil script transliterated by
 * an OCR engine that could not read it, columns of verse numbers, footnotes in
 * fragments. A tutor quoting that back to a student looks broken, so passages
 * that are mostly not letters are dropped at build time.
 */
function looksReadable(text) {
  const length = Math.max(1, text.length)
  const letters = (text.match(/[A-Za-z]/g) ?? []).length
  const odd = (text.match(/[^A-Za-z0-9 \n.,;:'"()\-–—?!]/g) ?? []).length
  if (letters / length < 0.74) return false
  if (odd / length > 0.08) return false
  // A paragraph of almost nothing but numbers is a table, not prose.
  const words = text.split(/\s+/).filter(Boolean)
  const numberish = words.filter(w => /^[^A-Za-z]*\d/.test(w) && !/[A-Za-z]{3}/.test(w)).length
  return numberish / Math.max(1, words.length) < 0.4
}

/**
 * Packs paragraphs into passages of roughly PASSAGE_WORDS words, remembering the
 * last heading seen so each passage keeps its place in the work.
 */
function passageise(text, workId) {
  const blocks = text.split('\n\n').map(b => b.replace(/\n/g, ' ').trim()).filter(Boolean)
  const passages = []
  let buffer = []
  let words = 0
  let ref = 'Opening'

  const flush = () => {
    if (!buffer.length) return
    const body = buffer.join('\n\n').trim()
    if (body.split(/\s+/).length >= 35 && looksReadable(body)) {
      passages.push({ id: `${workId}-${passages.length + 1}`, workId, ref, text: body })
    }
    buffer = []
    words = 0
  }

  for (const block of blocks) {
    const heading = headingOf(block)
    // A heading closes the passage it introduces only if it is a short line.
    if (heading && block.split(/\s+/).length <= 12) {
      flush()
      ref = heading
      continue
    }
    buffer.push(block)
    words += block.split(/\s+/).length
    if (words >= PASSAGE_WORDS) flush()
  }
  flush()
  return passages
}

async function fetchText(url, timeout = 90_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

async function archiveText(item) {
  const meta = await (await fetch(`https://archive.org/metadata/${item}`, { signal: AbortSignal.timeout(45_000) })).json()
  const file = (meta.files ?? []).find(f => /_djvu\.txt$/.test(f.name))
  if (!file) throw new Error(`no djvu.txt for ${item}`)
  return fetchText(`https://archive.org/download/${item}/${encodeURIComponent(file.name)}`)
}

/* ────────────────────────────────── build ────────────────────────────────── */

async function main() {
  if (process.argv.includes('--check')) {
    const { readFileSync, existsSync } = await import('node:fs')
    if (!existsSync(OUT_FILE)) return console.log('not built yet')
    const { gunzipSync } = await import('node:zlib')
    const corpus = JSON.parse(gunzipSync(readFileSync(OUT_FILE)).toString())
    console.log(`corpus: ${corpus.works.length} works, ${corpus.passages.length} passages`)
    for (const work of corpus.works) {
      const own = corpus.passages.filter(p => p.workId === work.id)
      console.log(`  ${work.title.padEnd(52)} ${String(own.length).padStart(5)} passages  ${work.translator}`)
    }
    return
  }

  const works = []
  const passages = []
  const failures = []

  const addWork = (spec, raw, { archive = false } = {}) => {
    const text = clean(raw, { archive })
    let own = passageise(text, spec.id)
    if (own.length < 25) {
      // Almost certainly the wrong scan (a Sanskrit edition of an English
      // translation, say) — fail loudly rather than shelve an empty book.
      throw new Error(`only ${own.length} readable passages — wrong edition?`)
    }
    const capped = own.slice(0, Math.ceil(WORK_WORD_CAP / PASSAGE_WORDS))
    if (capped.length < own.length) own = capped
    const words = own.reduce((sum, p) => sum + p.text.split(/\s+/).length, 0)
    works.push({
      id: spec.id,
      title: spec.title,
      sanskrit: spec.sanskrit,
      author: spec.author,
      translator: spec.translator,
      edition: spec.edition,
      year: spec.year,
      domain: spec.domain,
      extent: spec.extent,
      note: spec.note,
      sourceUrl: spec.pg ? `https://www.gutenberg.org/ebooks/${spec.pg}` : `https://archive.org/details/${spec.item}`,
      license: 'Public domain',
      passages: own.length,
      words,
    })
    passages.push(...own)
    console.log(`   ✓ ${spec.title.slice(0, 46).padEnd(48)} ${String(own.length).padStart(5)} passages  ${(words / 1000).toFixed(0)}k words`)
  }

  for (const spec of GUTENBERG) {
    try {
      const raw = await fetchText(`https://www.gutenberg.org/cache/epub/${spec.pg}/pg${spec.pg}.txt`)
      addWork(spec, raw)
    } catch (err) {
      failures.push(`${spec.title}: ${err.message}`)
    }
  }

  for (const spec of ARCHIVE) {
    // Archive.org items fail individually now and then; an alternate scan of the
    // same edition is worth one retry before giving up on a whole work.
    for (const item of [spec.item, ...(spec.altItems ?? [])]) {
      try {
        const raw = await archiveText(item)
        addWork(spec, raw, { archive: true })
        break
      } catch (err) {
        if (item === (spec.altItems ?? []).at(-1) || !spec.altItems?.length) {
          failures.push(`${spec.title}: ${err.message}`)
        }
      }
    }
  }

  const corpus = {
    built: new Date().toISOString(),
    note: 'Public-domain English translations of primary Indian works. Every passage quotes its translator verbatim.',
    works,
    passages,
  }
  const json = Buffer.from(JSON.stringify(corpus))
  const gz = gzipSync(json, { level: 9 })
  // A content hash, so a rebuilt corpus is visible in git instead of invisible.
  const digest = createHash('sha256').update(json).digest('hex').slice(0, 12)
  corpus.digest = digest
  const finalGz = gzipSync(Buffer.from(JSON.stringify(corpus)), { level: 9 })

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, finalGz)
  writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify({
    built: corpus.built,
    digest,
    works: works.map(({ id, title, sanskrit, author, translator, edition, year, domain, extent, note, sourceUrl, license, passages, words }) => ({
      id, title, sanskrit, author, translator, edition, year, domain, extent, note, sourceUrl, license, passages, words,
    })),
    passages: passages.length,
    bytes: { raw: json.byteLength, gzipped: finalGz.byteLength },
  }, null, 2))

  console.log(`\n${passages.length} passages, ${(json.byteLength / 1_048_576).toFixed(1)} MB raw → ${(finalGz.byteLength / 1_048_576).toFixed(1)} MB gzipped`)
  console.log(`written: ${OUT_FILE}  (digest ${digest})`)
  if (failures.length) console.log(`\nskipped:\n  ${failures.join('\n  ')}`)
}

main().catch(err => {
  console.error('build failed:', err.message)
  process.exit(1)
})
