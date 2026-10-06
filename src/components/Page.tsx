import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The frame every page inside the app shares.
 *
 * One width, one set of paddings, one type scale for the page title — so the
 * Library, the Shelf, Settings and the reader all sit on the same grid instead
 * of each inventing its own margins. The sandbox is deliberately the exception:
 * it is a workbench, not a page, and fills the viewport.
 */

export function PageFrame({
  children,
  width = 'reading',
  className,
}: {
  children: ReactNode
  /** `reading` is the prose column; `wide` is for lists and grids. */
  width?: 'reading' | 'wide'
  className?: string
}) {
  return (
    <div className="scrollbar-quiet h-full overflow-y-auto">
      <div
        className={cn(
          'mx-auto w-full px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:px-8',
          width === 'wide' ? 'max-w-4xl' : 'max-w-read',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  eyebrow,
  icon: Icon,
  actions,
}: {
  title: string
  description?: ReactNode
  /** Small line above the title, for pages that belong to a named section. */
  eyebrow?: string
  /** A lucide icon, or any component taking className/strokeWidth. */
  icon?: React.ElementType
  actions?: ReactNode
}) {
  return (
    <header className="mb-7">
      {eyebrow && (
        <p className="mb-1.5 flex items-center gap-2 text-ui-sm font-medium uppercase tracking-[0.14em] text-primary/90">
          {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
          {eyebrow}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[1.8rem]">
          {title}
        </h1>
        {actions}
      </div>
      {description && (
        <p className="mt-2 max-w-[68ch] font-serif text-reading text-muted-foreground text-pretty">{description}</p>
      )}
    </header>
  )
}
