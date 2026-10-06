/**
 * How speech is cut into pieces — shared by the browser and the server.
 *
 * One long request is the wrong shape for every provider BODHA uses: Fish
 * Audio reads 1 400 characters in a single take in ~33 s (which no sensible
 * timeout survives, and which leaves the student waiting in silence), while the
 * same passage sent as 320-character sentences is spoken in a fraction of the
 * time and starts playing almost immediately.
 *
 * The browser cuts text with this so read-aloud can begin after the first
 * sentence and keep one piece synthesising ahead of the voice. The server cuts
 * text with the same function so any other caller — a document paragraph, a
 * Live Mode turn — gets the same behaviour without knowing about it.
 *
 * This file is deliberately dependency-free: it runs in the client bundle, in
 * a route handler, and in tests.
 */

/** Roughly two spoken sentences: long enough to sound fluent, short enough to arrive fast. */
export const SPEECH_CHUNK_CHARS = 320

/**
 * Splits text into speakable pieces.
 *
 * `firstMaxChars` makes the opening piece shorter than the rest. Fish Audio
 * spends time in proportion to the text, so a 320-character opening costs ~8 s
 * of silence before the student hears anything, while a 140-character one is
 * speaking in ~3.5 s — after that the voice is ahead of playback and the longer
 * pieces cost nothing.
 */
export function chunkForSpeech(
  text: string,
  maxChars = SPEECH_CHUNK_CHARS,
  firstMaxChars = maxChars,
): string[] {
  const clean = text.trim()
  if (!clean) return []
  if (clean.length <= firstMaxChars) return [clean]
  if (clean.length <= maxChars) return [clean]

  const sentences = clean.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [clean]
  const chunks: string[] = []
  let buffer = ''
  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim())
    buffer = ''
  }

  for (const sentence of sentences) {
    const limit = chunks.length === 0 ? firstMaxChars : maxChars
    // A single sentence longer than the limit is broken on word boundaries.
    if (sentence.length > limit) {
      flush()
      let rest = sentence.trim()
      while (rest.length > (chunks.length === 0 ? firstMaxChars : maxChars)) {
        const room = chunks.length === 0 ? firstMaxChars : maxChars
        const cut = rest.lastIndexOf(' ', room)
        const at = cut > room * 0.5 ? cut : room
        chunks.push(rest.slice(0, at).trim())
        rest = rest.slice(at).trim()
      }
      buffer = rest ? `${rest} ` : ''
      continue
    }
    if ((buffer + sentence).length > limit) flush()
    buffer += sentence
  }
  flush()
  return chunks
}

/** Runs `fn` over every item with at most `limit` in flight at once. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
