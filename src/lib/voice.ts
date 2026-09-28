'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice helpers.
 *
 * Speech runs through our own server routes (/api/tts, /api/stt) so the Fish
 * Audio key stays on the server and the browser never talks to Fish directly.
 * Free-tier quotas run out, so every path degrades gracefully:
 *
 *   TTS: Fish Audio  →  browser SpeechSynthesis
 *   STT: Fish Audio  →  browser SpeechRecognition (Chrome/Edge/Safari)
 */

export type DictationError = 'denied' | 'unsupported' | 'failed' | 'no-credit' | 'no-speech' | null

export interface Speaker {
  speak: (text: string) => Promise<void>
  stop: () => void
  speaking: boolean
  supported: boolean
  /** 0…1 loudness of the voice right now — drives the live-mode lip sync. */
  getAmplitude: () => number
  /** True while the browser voice is speaking rather than Fish Audio. */
  usingBrowserVoice: boolean
}

/** Strips markdown so the voice never reads asterisks and code fences aloud. */
export function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (formula) ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*|__|[*_~|]/g, '')
    .replace(/^\s*[-•]\s+/gm, ', ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function useSpeaker(): Speaker {
  const [speaking, setSpeaking] = useState(false)
  const [supported, setSupported] = useState(true)
  const [usingBrowserVoice, setUsingBrowserVoice] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  // Typed off the DOM signature (Uint8Array<ArrayBuffer>) so it stays valid
  // across TypeScript versions.
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const rafRef = useRef<number | null>(null)

  const teardownAudio = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current = null
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    analyserRef.current = null
    dataRef.current = null
  }, [])

  const stop = useCallback(() => {
    teardownAudio()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    setSpeaking(false)
    setUsingBrowserVoice(false)
  }, [teardownAudio])

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && ('speechSynthesis' in window || typeof Audio !== 'undefined'))
    return () => {
      teardownAudio()
      ctxRef.current?.close().catch(() => {})
    }
  }, [teardownAudio])

  /** Browser voice — the always-available fallback. */
  const speakWithBrowser = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeaking(false)
      return
    }
    const clean = stripMarkdownForSpeech(text)
    const chunks = clean.match(/[^.!?…]+[.!?…]*\s*/g) ?? [clean]
    const pieces: string[] = []
    let buf = ''
    for (const c of chunks) {
      if ((buf + c).length > 200) {
        if (buf.trim()) pieces.push(buf.trim())
        buf = c
      } else buf += c
    }
    if (buf.trim()) pieces.push(buf.trim())

    const voices = window.speechSynthesis.getVoices()
    const preferred =
      voices.find(v => /en[-_](GB|US)/i.test(v.lang) && /samantha|serena|aria|jenny|female/i.test(v.name)) ??
      voices.find(v => /en[-_]/i.test(v.lang)) ??
      null

    setUsingBrowserVoice(true)
    let remaining = pieces.length
    pieces.forEach(piece => {
      const u = new SpeechSynthesisUtterance(piece)
      u.rate = 0.98
      u.pitch = 1
      if (preferred) u.voice = preferred
      u.onend = () => {
        remaining -= 1
        if (remaining <= 0) {
          setSpeaking(false)
          setUsingBrowserVoice(false)
        }
      }
      u.onerror = () => {
        setSpeaking(false)
        setUsingBrowserVoice(false)
      }
      window.speechSynthesis.speak(u)
    })
    setSpeaking(pieces.length > 0)
  }, [])

  const speak = useCallback(
    async (rawText: string) => {
      const text = stripMarkdownForSpeech(rawText).slice(0, 1200)
      if (!text) return
      stop()

      // 1. Fish Audio through our server route.
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          urlRef.current = url
          const audio = new Audio(url)
          audioRef.current = audio

          // Amplitude graph for the live-mode mouth.
          try {
            const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (Ctor && !ctxRef.current) ctxRef.current = new Ctor()
            const ctx = ctxRef.current
            if (ctx) {
              await ctx.resume().catch(() => {})
              const source = ctx.createMediaElementSource(audio)
              const analyser = ctx.createAnalyser()
              analyser.fftSize = 512
              analyser.smoothingTimeConstant = 0.72
              source.connect(analyser)
              analyser.connect(ctx.destination)
              analyserRef.current = analyser
              dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
            }
          } catch {
            // Amplitude is a nicety; playback continues without it.
          }

          audio.onended = () => {
            setSpeaking(false)
            teardownAudio()
          }
          audio.onerror = () => {
            setSpeaking(false)
            teardownAudio()
          }
          setSpeaking(true)
          await audio.play().catch(() => {
            setSpeaking(false)
            teardownAudio()
          })
          return
        }
      } catch {
        // fall through to the browser voice
      }

      // 2. Browser voice.
      speakWithBrowser(text)
    },
    [speakWithBrowser, stop, teardownAudio],
  )

  const getAmplitude = useCallback(() => {
    const analyser = analyserRef.current
    const data = dataRef.current
    if (!analyser || !data) return 0
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / data.length)
    return Math.min(1, rms * 3.2)
  }, [])

  return { speak, stop, speaking, supported, getAmplitude, usingBrowserVoice }
}

export interface Dictation {
  listening: boolean
  transcribing: boolean
  interim: string
  error: DictationError
  supported: boolean
  usingBrowser: boolean
  toggle: () => void
  stop: () => void
  clearError: () => void
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> & { length: number } }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

function speechRecognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Dictation: record with MediaRecorder → /api/stt (Fish Audio transcribe-1).
 * If the server has no credit, it falls back to the browser's own recognition.
 */
export function useDictation(onFinal: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<DictationError>(null)
  const [usingBrowser, setUsingBrowser] = useState(false)
  const [supported, setSupported] = useState(true)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal

  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        (typeof navigator.mediaDevices?.getUserMedia === 'function' || !!speechRecognitionCtor()),
    )
    return () => {
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach(t => t.stop())
      recognitionRef.current?.abort()
    }
  }, [])

  const startBrowserDictation = useCallback(() => {
    const Ctor = speechRecognitionCtor()
    if (!Ctor) {
      setError('unsupported')
      return false
    }
    try {
      const rec = new Ctor()
      recognitionRef.current = rec
      rec.lang = navigator.language || 'en-US'
      rec.continuous = true
      rec.interimResults = true
      let finalText = ''
      rec.onresult = e => {
        let live = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]
          if (result.isFinal) finalText += result[0].transcript
          else live += result[0].transcript
        }
        setInterim(live)
        if (finalText.trim()) {
          finalRef.current(finalText.trim())
          finalText = ''
        }
      }
      rec.onerror = e => {
        setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'no-speech' : 'failed')
        setListening(false)
      }
      rec.onend = () => {
        if (recognitionRef.current === rec) {
          try {
            rec.start()
          } catch {
            recognitionRef.current = null
            setListening(false)
          }
        }
      }
      setError(null)
      rec.start()
      setUsingBrowser(true)
      setListening(true)
      return true
    } catch {
      setError('failed')
      return false
    }
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      startBrowserDictation()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = e => {
        if (e.data.size) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
        setListening(false)

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size < 1500) return // too short to be speech

        setTranscribing(true)
        try {
          const form = new FormData()
          form.append('audio', blob, 'recording.webm')
          const res = await fetch('/api/stt', { method: 'POST', body: form })
          if (res.ok) {
            const data = await res.json().catch(() => ({}))
            if (typeof data.text === 'string' && data.text.trim()) {
              finalRef.current(data.text.trim())
              return
            }
            setError('no-speech')
            return
          }
          if (res.status === 402 || res.status === 503) {
            // No Fish Audio credit → hand over to the browser recogniser.
            setError('no-credit')
            startBrowserDictation()
            return
          }
          setError('failed')
        } catch {
          setError('failed')
        } finally {
          setTranscribing(false)
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setUsingBrowser(false)
      setListening(true)
    } catch (err) {
      if ((err as Error).name === 'NotAllowedError') setError('denied')
      else startBrowserDictation()
    }
  }, [startBrowserDictation])

  const toggle = useCallback(() => {
    if (listening) stop()
    else void start()
  }, [listening, start, stop])

  return {
    listening,
    transcribing,
    interim,
    error,
    supported,
    usingBrowser,
    toggle,
    stop,
    clearError: () => setError(null),
  }
}
