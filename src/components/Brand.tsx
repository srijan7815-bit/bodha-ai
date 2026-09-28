import { cn } from '@/lib/utils'

/**
 * BODHA identity.
 *
 * The wordmark is बोध — "awakening" — set in Tiro Devanagari Hindi, paired with
 * a small diya (oil lamp) mark that carries the same idea of a flame that lights
 * understanding. The mark is drawn as SVG so it stays crisp at every size and
 * never depends on a font being available for the glyph.
 */

interface MarkProps {
  className?: string
  /** Tile size in px; the glyph scales with it. */
  size?: number
  /** Rendered on the warm primary tile (default) or as bare ink. */
  tone?: 'primary' | 'plain'
}

/** The flame mark — a diya flame with its bowl of light. */
export function BodhaMark({ className, size = 32, tone = 'primary' }: MarkProps) {
  const radius = size * 0.28
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden',
        tone === 'primary' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-primary',
        className,
      )}
      style={{ width: size, height: size, borderRadius: radius }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        {/* flame */}
        <path
          d="M12 2.6c-2.6 2.9-4.1 5.4-4.1 7.7a4.1 4.1 0 0 0 8.2 0c0-2.3-1.5-4.8-4.1-7.7Z"
          fill="currentColor"
        />
        {/* inner glow */}
        <path d="M12 8.1c-1.2 1.35-1.9 2.5-1.9 3.6a1.9 1.9 0 0 0 3.8 0c0-1.1-.7-2.25-1.9-3.6Z" fill="#FAF7F2" opacity=".9" />
        {/* bowl of the diya */}
        <path
          d="M4.6 15.4c1.3 2.9 4.1 4.6 7.4 4.6s6.1-1.7 7.4-4.6c-2 .9-4.6 1.4-7.4 1.4s-5.4-.5-7.4-1.4Z"
          fill="currentColor"
          opacity=".82"
        />
      </svg>
    </span>
  )
}

interface WordmarkProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  /** Show "AI" after the Devanagari word. */
  withAI?: boolean
  /** Show the small Latin transliteration under the word. */
  withLatin?: boolean
}

const SIZES = {
  sm: { word: 'text-[17px]', ai: 'text-[10px]', latin: 'text-[8px]', gap: 'gap-1.5' },
  md: { word: 'text-[22px]', ai: 'text-[12px]', latin: 'text-[9px]', gap: 'gap-2' },
  lg: { word: 'text-[38px]', ai: 'text-[18px]', latin: 'text-[11px]', gap: 'gap-2.5' },
  xl: { word: 'text-[56px] sm:text-[68px]', ai: 'text-[26px] sm:text-[30px]', latin: 'text-[12px]', gap: 'gap-3' },
} as const

/**
 * बोध + optional AI suffix. Devanagari sits optically larger than Latin, so the
 * "AI" mark is deliberately smaller and letterspaced.
 */
export function BodhaWordmark({ size = 'md', className, withAI = true, withLatin = false }: WordmarkProps) {
  const s = SIZES[size]
  return (
    <span className={cn('inline-flex items-baseline', s.gap, className)}>
      <span className={cn('font-deva leading-none text-foreground', s.word)}>बोध</span>
      {withAI && (
        <span className={cn('font-sans font-medium uppercase leading-none tracking-[0.22em] text-primary', s.ai)}>
          AI
        </span>
      )}
      {withLatin && (
        <span className={cn('font-sans uppercase leading-none tracking-[0.3em] text-muted-foreground', s.latin)}>
          bodha
        </span>
      )}
    </span>
  )
}

/** Mark + wordmark lockup used in the header, sidebar and auth screens. */
export function BodhaLogo({
  size = 'md',
  markSize,
  className,
  withAI = true,
}: {
  size?: WordmarkProps['size']
  markSize?: number
  className?: string
  withAI?: boolean
}) {
  const px = markSize ?? (size === 'sm' ? 28 : size === 'xl' ? 52 : size === 'lg' ? 44 : 34)
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BodhaMark size={px} />
      <BodhaWordmark size={size} withAI={withAI} />
    </span>
  )
}
