/** Filename → tidy, human title. "Class 10 - Physics_ch.3 (final).pdf" → "Class 10 · Physics ch.3". */
export function titleFromFilename(filename: string, max = 72): string {
  const base = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' · ')
    .replace(/\(.*?\)/g, '')
    .replace(/(final|draft|copy|v\d+)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!base) return 'Untitled document'
  if (base.length <= max) return base
  const clipped = base.slice(0, max)
  const space = clipped.lastIndexOf(' ')
  return `${(space > max * 0.6 ? clipped.slice(0, space) : clipped).trim()}…`
}

/** A short label for lists and chips. */
export function shortTitle(title: string, max = 42): string {
  return title.length <= max ? title : `${title.slice(0, max).trim()}…`
}
