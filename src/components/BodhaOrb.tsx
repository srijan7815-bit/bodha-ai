'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
// The WebGL engine from the user's nrvs-ai repo, copied verbatim (see its header).
import { createOrb } from '@/lib/orbEngine'
import { sampleAudio } from '@/lib/orbAudio'

export type OrbState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'

interface OrbHandle {
  resize: (w: number, h: number) => void
  start: () => void
  stop: () => void
  setState: (name: string) => void
  setTheme: (theme: string) => void
  setReducedMotion: (value: boolean) => void
  setAudioLevel?: (value: number | null) => void
  dispose: () => void
}

interface BodhaOrbProps {
  state: OrbState
  className?: string
  /** 'dark' by default: Live Mode is an immersive room, not a page. */
  theme?: 'dark' | 'light'
  /** Optional external level 0…1 (otherwise the shared audio bus is sampled). */
  level?: number
}

/**
 * The presence at the centre of Live Mode.
 *
 * Decorative by design — every state is also said in words elsewhere in the
 * room — so it is aria-hidden and falls back to a calm CSS sphere on devices
 * without WebGL2 rather than showing an empty box.
 */
export default function BodhaOrb({ state, className, theme = 'dark', level }: BodhaOrbProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const orbRef = useRef<OrbHandle | null>(null)
  const [failed, setFailed] = useState(false)
  // Bumped after a lost context: a canvas whose context was lost can never hand
  // out a working one again, so the engine is rebuilt on a fresh canvas.
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return undefined

    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    wrap.appendChild(canvas)

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const orb = createOrb(canvas, {
      quality: 'auto',
      theme,
      reducedMotion: Boolean(reduced?.matches),
      sampleAudio,
      onError: () => setFailed(true),
    }) as OrbHandle | null

    if (!orb) {
      setFailed(true)
      canvas.remove()
      return undefined
    }

    setFailed(false)
    orbRef.current = orb

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect
      if (rect.width > 0 && rect.height > 0) orb.resize(rect.width, rect.height)
    })
    observer.observe(wrap)
    const box = wrap.getBoundingClientRect()
    orb.resize(Math.max(1, box.width), Math.max(1, box.height))

    const onMotion = (event: MediaQueryListEvent) => orb.setReducedMotion(event.matches)
    reduced?.addEventListener?.('change', onMotion)

    // Never burn a phone's GPU on a hidden tab.
    const onVisibility = () => (document.hidden ? orb.stop() : orb.start())
    document.addEventListener('visibilitychange', onVisibility)

    const onRestored = () => setEpoch(n => n + 1)
    canvas.addEventListener('webglcontextrestored', onRestored)

    orb.start()
    return () => {
      observer.disconnect()
      reduced?.removeEventListener?.('change', onMotion)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      orb.dispose()
      canvas.remove()
      orbRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, epoch])

  useEffect(() => {
    orbRef.current?.setState(state)
  }, [state])

  useEffect(() => {
    if (level === undefined) return
    orbRef.current?.setAudioLevel?.(level)
  }, [level])

  return (
    <div ref={wrapRef} className={cn('relative h-full w-full', className)} aria-hidden="true">
      {failed && (
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="h-3/5 w-3/5 rounded-full"
            style={{
              background:
                theme === 'light'
                  ? 'radial-gradient(circle at 38% 32%, #FFB489 0%, #C1633B 42%, #6B3018 82%)'
                  : 'radial-gradient(circle at 38% 32%, #FF9A5C 0%, #C1633B 40%, #3A1A0C 82%)',
              opacity: 0.92,
            }}
          />
        </div>
      )}
    </div>
  )
}
