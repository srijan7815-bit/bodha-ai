'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ModelChoice } from '@/lib/types'

/**
 * The model switch — and it only exists when it has something to say.
 *
 * It appears in the chat header for students who have connected their own
 * endpoint, and nowhere else: with one brain there is nothing to switch, and a
 * control that does nothing is just noise in a reading-first interface.
 *
 * Both segments are named after what they are — बोध, and the student's own
 * label — because "Model A / Model B" tells nobody anything.
 */
export default function ModelToggle({
  label,
  value,
  onChange,
  busy,
}: {
  /** The student's name for their own model. */
  label: string
  value: ModelChoice
  onChange: (next: ModelChoice) => void
  busy?: boolean
}) {
  const options: Array<{ id: ModelChoice; text: string; title: string }> = [
    { id: 'bodha', text: 'बोध', title: 'BODHA’s own teaching models' },
    { id: 'custom', text: label, title: `Your model — ${label}` },
  ]

  return (
    <div
      role="radiogroup"
      aria-label="Which model answers"
      className="relative flex h-8 shrink-0 items-center rounded-full border border-border/70 bg-surface p-0.5"
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
            title={option.title}
            onClick={() => {
              if (!active) onChange(option.id)
            }}
            className={cn(
              'relative h-7 max-w-[68px] rounded-full px-2.5 text-ui-sm transition-colors disabled:opacity-60 sm:max-w-[104px]',
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
            <span className="relative block truncate">{option.text}</span>
          </button>
        )
      })}
    </div>
  )
}
