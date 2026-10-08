'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { attachMic, buildEnvelope, currentLevel, detachMic, resumeOrbAudio, setVoiceEnvelope, trackVoicePlayback } from '@/lib/orbAudio'
import { toWav } from '@/lib/audio'
import { chunkForSpeech } from '@/lib/speech-chunks'

/**
 * Voice helpers.
 *
 * Speech runs through our own server routes (/api/tts, /api/stt) so the keys
 * stay on the server and the browser never talks to a vendor directly. Two
 * rules keep it working:
 *
 *   • Read-aloud is spoken a sentence or two at a time, not in one long take.
 *     A full answer sent as a single request makes Fish Audio work for half a
 *     minute before a student hears anything, and a timeout then loses the whole
 *     passage; cut into 320-character pieces the first words arrive in about
 *     two seconds and the rest synthesises while they are being listened to.
 *   • Playback always lives on the normal <audio> path. Nothing is ever routed
 *     through Web Audio, because a suspended graph makes an element silent —
 *     the animation would then be the reason nobody can hear BODHA. The
 *     envelope for lip-sync is measured offline from the same bytes instead.
 *   • Every layer degrades in a useful direction:
 *       TTS: Fish Audio → NVIDIA Magpie → the browser's own voice
 *       STT: NVIDIA Parakeet → Fish Audio → the browser's recogniser
 */

export type DictationError = 'denied' | 'unsupported' | 'failed' | 'no-speech' | 'no-credit' | null

/** Which voice read-aloud should ask for first. */
export type ReadAloudProvider = 'fish' | 'magpie' | 'auto'

export interface Speaker {
  speak: (
    text: string,
    opts?: { onDone?: () => void; provider?: ReadAloudProvider; voice?: string },
  ) => Promise<void>
  stop: () => void
  speaking: boolean
  supported: boolean
  /** 0…1 loudness of the voice right now — drives the Live Mode orb. */
  getAmplitude: () => number
  /** True while the browser's own voice is doing the talking. */
  usingBrowserVoice: boolean
}

/** Strips markdown so the voice never reads asterisks and code fences aloud. */
export function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0E\uFE0F\u200D\u20E3\u{1F3FB}-\u{1F3FF}\u2600-\u27BF\u2B00-\u2BFF]/gu, '')
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
  const rafRef = useRef<number | null>(null)
  const onDoneRef = useRef<(() => void) | null>(null)
  const finishedRef = useRef(false)

  const teardown = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const audio = audioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.onpause = null
      try {
        audio.pause()
      } catch {}
      audioRef.current = null
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setVoiceEnvelope(null)
  }, [])

  /** One completion path, so `onDone` can never fire twice. */
  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    teardown()
    setSpeaking(false)
    setUsingBrowserVoice(false)
    const done = onDoneRef.current
    onDoneRef.current = null
    done?.()
  }, [teardown])

  const stop = useCallback(() => {
    onDoneRef.current = null
    finishedRef.current = true
    teardown()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    setSpeaking(false)
    setUsingBrowserVoice(false)
  }, [teardown])

  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
        ('speechSynthesis' in window || typeof Audio !== 'undefined'),
    )
    return () => {
      teardown()
    }
  }, [teardown])

  /** The always-available fallback: whatever voice the device already has. */
  const speakWithBrowser = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        finish()
        return
      }
      const clean = stripMarkdownForSpeech(text)
      if (!clean) {
        finish()
        return
      }
      const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) ?? [clean]
      const chunks: string[] = []
      let buffer = ''
      for (const sentence of sentences) {
        if ((buffer + sentence).length > 200) {
          if (buffer.trim()) chunks.push(buffer.trim())
          buffer = sentence
        } else buffer += sentence
      }
      if (buffer.trim()) chunks.push(buffer.trim())

      const voices = window.speechSynthesis.getVoices()
      const preferred =
        voices.find(v => /en[-_](GB|US)/i.test(v.lang) && /samantha|serena|aria|jenny|zira/i.test(v.name)) ??
        voices.find(v => /en[-_]/i.test(v.lang)) ??
        null

      setUsingBrowserVoice(true)
      setSpeaking(true)
      let remaining = chunks.length || 1
      if (!chunks.length) {
        finish()
        return
      }
      chunks.forEach(chunk => {
        const utterance = new SpeechSynthesisUtterance(chunk)
        utterance.rate = 0.98
        if (preferred) utterance.voice = preferred
        utterance.onend = () => {
          remaining -= 1
          if (remaining <= 0) finish()
        }
        utterance.onerror = () => finish()
        window.speechSynthesis.speak(utterance)
      })
    },
    [finish],
  )

  const speak = useCallback(
    async (rawText: string, opts?: { onDone?: () => void; provider?: ReadAloudProvider; voice?: string }) => {
      const text = stripMarkdownForSpeech(rawText).slice(0, 1400)
      if (!text) return
      stop()
      finishedRef.current = false
      onDoneRef.current = opts?.onDone ?? null

      // A gesture is on the stack (the student tapped), so this will stick.
      void resumeOrbAudio()

      const provider = opts?.provider ?? 'auto'
      const voice = opts?.voice
      // A short opening piece starts the voice sooner; the rest are cut longer
      // and are fetched at the same time, so playback never waits for them.
      const chunks = chunkForSpeech(text, 320, 140)
      if (!chunks.length) {
        finish()
        return
      }

      /** One piece of speech from the server, already turned into a playable URL. */
      const fetchClip = async (chunk: string): Promise<{ url: string; bytes: ArrayBuffer } | null> => {
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk, provider, voice }),
          })
          if (!res.ok) return null
          const bytes = await res.arrayBuffer()
          if (bytes.byteLength <= 1000) return null
          const url = URL.createObjectURL(
            new Blob([bytes], { type: res.headers.get('content-type') || 'audio/mpeg' }),
          )
          return { url, bytes }
        } catch {
          return null
        }
      }

      /** Plays one clip to its end. False means this browser refused the audio. */
      const playClip = (url: string) =>
        new Promise<boolean>(resolve => {
          const audio = new Audio(url)
          audio.preload = 'auto'
          audio.crossOrigin = 'anonymous'
          audioRef.current = audio
          urlRef.current = url
          audio.onended = () => resolve(true)
          audio.onerror = () => resolve(false)

          const tick = () => {
            const el = audioRef.current
            if (!el) return
            trackVoicePlayback(el.currentTime, !el.paused && !el.ended)
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
          audio.play().catch(() => resolve(false))
        })

      /** The device voice, given whatever is still unspoken. */
      const handOver = (from: number) => {
        teardown()
        speakWithBrowser(chunks.slice(from).join(' '))
      }

      setSpeaking(true)
      setUsingBrowserVoice(false)

      // Every piece is requested at once and played in order: Fish Audio
      // answers these in parallel, so the opening sentence is speaking while the
      // rest of the answer is still being generated.
      const clips = chunks.map(chunk => fetchClip(chunk))
      for (let index = 0; index < chunks.length; index += 1) {
        const clip = await clips[index]
        if (finishedRef.current) {
          if (clip) URL.revokeObjectURL(clip.url)
          return
        }

        if (!clip) {
          // No server audio for this piece — the device voice reads the rest
          // rather than leaving the answer half-spoken.
          handOver(index)
          return
        }

        if (index === 0) {
          // Envelope for the orb — decoded separately, never routed through the
          // audio element's own output.
          void buildEnvelope(clip.bytes).then(envelope => {
            if (audioRef.current) setVoiceEnvelope(envelope)
          })
        }

        const played = await playClip(clip.url)
        if (!played) {
          handOver(index)
          return
        }
        if (!finishedRef.current) {
          URL.revokeObjectURL(clip.url)
          if (urlRef.current === clip.url) urlRef.current = null
        }
      }

      if (!finishedRef.current) finish()
    },
    [finish, speakWithBrowser, stop, teardown],
  )

  return {
    speak,
    stop,
    speaking,
    supported,
    getAmplitude: currentLevel,
    usingBrowserVoice,
  }
}

export interface Dictation {
  listening: boolean
  transcribing: boolean
  interim: string
  error: DictationError
  supported: boolean
  usingBrowser: boolean
  start: () => void
  stop: () => void
  toggle: () => void
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
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike
    webkitSpeechRecognition?: new () => RecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Dictation: record with MediaRecorder → /api/stt (NVIDIA Parakeet).
 * If the server has no working provider, the browser's own recogniser takes
 * over mid-session instead of leaving the student with a dead button.
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
  const detachRef = useRef<(() => void) | null>(null)
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const stoppingRef = useRef(false)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal

  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        (typeof navigator.mediaDevices?.getUserMedia === 'function' || !!speechRecognitionCtor()),
    )
    return () => {
      try {
        recorderRef.current?.stop()
      } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop())
      detachRef.current?.()
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
      const recognition = new Ctor()
      recognitionRef.current = recognition
      recognition.lang = navigator.language || 'en-US'
      recognition.continuous = true
      recognition.interimResults = true
      let finalText = ''
      recognition.onresult = event => {
        let live = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) finalText += result[0].transcript
          else live += result[0].transcript
        }
        setInterim(live)
        if (finalText.trim()) {
          finalRef.current(finalText.trim())
          finalText = ''
        }
      }
      recognition.onerror = event => {
        setError(
          event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'denied'
            : event.error === 'no-speech'
              ? 'no-speech'
              : 'failed',
        )
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          recognitionRef.current = null
          setListening(false)
        }
      }
      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          try {
            recognition.start()
          } catch {
            recognitionRef.current = null
            setListening(false)
          }
        }
      }
      setError(null)
      recognition.start()
      setUsingBrowser(true)
      setListening(true)
      return true
    } catch {
      setError('failed')
      return false
    }
  }, [])

  const stop = useCallback(() => {
    stoppingRef.current = true
    recognitionRef.current?.stop()
    recognitionRef.current = null
    try {
      recorderRef.current?.stop()
    } catch {}
    recorderRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    detachRef.current?.()
    detachRef.current = null
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setUsingBrowser(false)
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      startBrowserDictation()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      // The orb listens with us — real levels, no rerouting of any playback.
      void resumeOrbAudio().then(() => attachMic(stream).then(detach => (detachRef.current = detach)))

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
      const mimeType = candidates.find(t => !t || (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))) ?? ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      chunksRef.current = []
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
        detachRef.current?.()
        detachRef.current = null
        setListening(false)
        if (!chunksRef.current.length) return

        const type = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []
        if (blob.size < 1200) return // a tap, not a sentence

        setTranscribing(true)
        try {
          // Re-encode to 16 kHz mono WAV: the ASR endpoint answers 500 for an
          // MP3 and is happiest with clean PCM, and every browser can decode
          // what it just recorded.
          const wav = await toWav(blob)
          const payload = wav ?? blob
          const filename = wav ? 'recording.wav' : /mp4|m4a|aac/i.test(type) ? 'recording.m4a' : /ogg/i.test(type) ? 'recording.ogg' : 'recording.webm'

          const form = new FormData()
          form.append('audio', payload, filename)
          const res = await fetch('/api/stt', { method: 'POST', body: form })
          const data = await res.json().catch(() => ({}))
          if (res.ok && typeof data.text === 'string' && data.text.trim()) {
            finalRef.current(data.text.trim())
            return
          }
          if (data?.fallback) {
            setError('no-credit')
            startBrowserDictation()
            return
          }
          setError(res.status === 422 ? 'no-speech' : 'failed')
        } catch {
          setError('failed')
        } finally {
          setTranscribing(false)
        }
      }

      recorderRef.current = recorder
      recorder.start()
      setListening(true)
    } catch (err) {
      if ((err as Error).name === 'NotAllowedError') setError('denied')
      else if (!startBrowserDictation()) setError('failed')
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
    start,
    stop,
    toggle,
    clearError: () => setError(null),
  }
}
