'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * The model switch — and it only exists when it has something to say.
 *
 * It appears in the chat header for students who have connected their own
 * endpoint, and nowhere else: with one brain there is nothing to switch, and a
 * control that does nothing is just noise in a reading-first interface.
 *
 * An endpoint can carry several models, so the switch scrolls sideways rather
 * than growing without limit — on a phone it stays one row tall and the chat
 * title keeps its room.
 */
export interface ToggleOption {
  id: string
  label: string
}

export default function ModelToggle({
  options,
  value,
  onChange,
  busy,
}: {
  options: ToggleOption[]
  value: string
  onChange: (next: string) => void
  busy?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Which model answers"
      className="scrollbar-quiet flex h-8 max-w-[45vw] shrink-0 snap-x items-center gap-0.5 overflow-x-auto rounded-full border border-border/70 bg-surface p-0.5 sm:max-w-[320px]"
    >
      {options.map(option => {
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={busy}
            title={option.label}
            onClick={() => {
              if (!active) onChange(option.id)
            }}
            className={cn(
              'relative h-7 shrink-0 snap-start rounded-full px-2.5 text-ui-sm transition-colors disabled:opacity-60',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId="model-toggle-pill"
                className="absolute inset-0 rounded-full bg-foreground/[0.07]"
                transition={{ type: 'spring', stiffness: 480, damping: 40 }}
              />
            )}
            <span className="relative block max-w-[104px] truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
