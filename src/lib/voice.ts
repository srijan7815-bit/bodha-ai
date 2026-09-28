'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice for BODHA — built on Fish Audio API:
 *  - TTS: s2.1-pro-free model for high-quality speech
 *  - STT: transcribe-1 model for dictation
 * Gracefully falls back to browser Web Speech API if Fish Audio unavailable.
 */

// ─── Types ────────────────────────────────────────────────────────────────

interface FishTTSRequest {
  text: string
  model: string
  voice?: string
  latency?: 'normal' | 'balanced' | 'high'
}

interface FishSTTRequest {
  audio: Blob
  model: string
  language?: string
}

export type DictationError = 'unsupported' | 'denied' | 'network' | 'no-speech' | 'failed'

// ─── Fish Audio TTS ───────────────────────────────────────────────────────

const FISH_TTS_ENDPOINT = 'https://api.fish.audio/v1/tts'
const FISH_STT_ENDPOINT = 'https://api.fish.audio/v1/asr'

let fishAudioKey: string | null = null

export function setFishAudioKey(key: string) {
  fishAudioKey = key
}

export async function speakWithFish(text: string): Promise<HTMLAudioElement | null> {
  if (!fishAudioKey || typeof window === 'undefined') return null

  const cleanText = stripMarkdownForSpeech(text)
  if (!cleanText) return null

  try {
    const res = await fetch(FISH_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fishAudioKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: cleanText,
        model: process.env.NEXT_PUBLIC_FISH_AUDIO_TTS_MODEL || 's2.1-pro-free',
        latency: 'balanced',
      } satisfies FishTTSRequest),
    })

    if (!res.ok) {
      console.warn('[Fish TTS] Request failed:', res.status)
      return null
    }

    const audioBlob = await res.blob()
    const audioUrl = URL.createObjectURL(audioBlob)
    const audio = new Audio(audioUrl)
    return audio
  } catch (e) {
    console.warn('[Fish TTS] Error:', e)
    return null
  }
}

// ─── Fish Audio STT ───────────────────────────────────────────────────────

export async function transcribeWithFish(audioBlob: Blob): Promise<string | null> {
  if (!fishAudioKey || typeof window === 'undefined') return null

  try {
    const formData = new FormData()
    formData.append('audio', audioBlob, 'recording.webm')
    formData.append('model', process.env.NEXT_PUBLIC_FISH_AUDIO_STT_MODEL || 'transcribe-1')
    formData.append('language', 'en')

    const res = await fetch(FISH_STT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fishAudioKey}`,
      },
      body: formData,
    })

    if (!res.ok) {
      console.warn('[Fish STT] Request failed:', res.status)
      return null
    }

    const data = await res.json()
    return data.text ?? data.transcript ?? null
  } catch (e) {
    console.warn('[Fish STT] Error:', e)
    return null
  }
}

// ─── Markdown stripping for natural speech ────────────────────────────────

export function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code example omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$\$[^$]*\$\$/g, ' (math) ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~|]+/g, '')
    .replace(/^\s*[-•]\s+/gm, ', ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ─── Browser SpeechSynthesis fallback (TTS) ───────────────────────────────

export function useSpeaker() {
  const [speaking, setSpeaking] = useState(false)
  const [supported, setSupported] = useState(true)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([])

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window)
    return () => {
      stop()
    }
  }, [])

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    utterancesRef.current = []
    setSpeaking(false)
  }, [])

  const speak = useCallback(
    async (text: string) => {
      stop()

      // Try Fish Audio first
      const fishAudio = await speakWithFish(text)
      if (fishAudio) {
        audioRef.current = fishAudio
        setSpeaking(true)
        fishAudio.onended = () => {
          setSpeaking(false)
          audioRef.current = null
        }
        fishAudio.onerror = () => {
          setSpeaking(false)
          audioRef.current = null
        }
        fishAudio.play().catch(() => {
          setSpeaking(false)
        })
        return
      }

      // Fallback to browser speechSynthesis
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

      const clean = stripMarkdownForSpeech(text)
      if (!clean) return

      const chunks = clean.match(/[^.!?…]+[.!?…]*/g) ?? [clean]
      const pieces: string[] = []
      let buf = ''
      for (const chunk of chunks) {
        if ((buf + chunk).length > 220) {
          if (buf) pieces.push(buf.trim())
          buf = chunk
        } else {
          buf += chunk
        }
      }
      if (buf.trim()) pieces.push(buf.trim())

      const voices = window.speechSynthesis.getVoices()
      const preferred =
        voices.find(v => /en[-_](GB|US)/i.test(v.lang) && /female|samantha|serena|zira|aria|jenny/i.test(v.name)) ??
        voices.find(v => /en[-_]/i.test(v.lang)) ??
        null

      const utterances = pieces.map(piece => {
        const u = new SpeechSynthesisUtterance(piece)
        u.rate = 0.98
        u.pitch = 1.0
        if (preferred) u.voice = preferred
        return u
      })

      let done = 0
      for (const u of utterances) {
        u.onend = () => {
          done += 1
          if (done >= utterances.length) setSpeaking(false)
        }
        u.onerror = () => setSpeaking(false)
        window.speechSynthesis.speak(u)
      }
      utterancesRef.current = utterances
      setSpeaking(utterances.length > 0)
    },
    [stop],
  )

  return { speak, stop, speaking, supported }
}

// ─── Browser SpeechRecognition fallback (STT/Dictation) ───────────────────

interface SRAlternative {
  transcript: string
}
interface SRResult {
  isFinal: boolean
  length: number
  [index: number]: SRAlternative
}
interface SREvent {
  resultIndex: number
  results: { length: number; [index: number]: SRResult }
}
interface SRErrorEvent {
  error: string
}
interface SRInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  onend: (() => void) | null
}
type SRCtor = new () => SRInstance

function getSpeechRecognition(): SRCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return getSpeechRecognition() !== null
}

export function useDictation(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<DictationError | null>(null)
  const recRef = useRef<SRInstance | null>(null)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal

  const stop = useCallback(() => {
    recRef.current?.stop()
    recRef.current = null
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      setError('unsupported')
      return
    }
    try {
      const rec = new Ctor()
      recRef.current = rec
      rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'
      rec.continuous = true
      rec.interimResults = true
      rec.maxAlternatives = 1

      let finalText = ''
      rec.onresult = (e) => {
        let interimText = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]
          const alt = result[0]
          if (result.isFinal) finalText += alt.transcript
          else interimText += alt.transcript
        }
        setInterim(interimText)
        if (finalText.trim()) {
          finalRef.current(finalText.trim())
          finalText = ''
        }
      }
      rec.onerror = (e) => {
        const map: Record<string, DictationError> = {
          'not-allowed': 'denied',
          'service-not-allowed': 'denied',
          network: 'network',
          'no-speech': 'no-speech',
          aborted: 'no-speech',
        }
        setError(map[e.error] ?? 'failed')
        setListening(false)
      }
      rec.onend = () => {
        if (recRef.current === rec) {
          try {
            rec.start()
          } catch {
            recRef.current = null
            setListening(false)
          }
        }
      }
      setError(null)
      rec.start()
      setListening(true)
    } catch {
      setError('failed')
    }
  }, [])

  useEffect(() => () => recRef.current?.abort(), [])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return { listening, interim, error, start, stop, toggle, clearError: () => setError(null) }
}