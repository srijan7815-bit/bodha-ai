'use client'

/**
 * Browser audio → WAV.
 *
 * Recordings arrive as whatever the browser likes best: Chrome gives Opus in
 * WebM, iOS Safari gives AAC in MP4, Firefox gives Ogg. The NVIDIA speech
 * endpoint is happiest with plain 16 kHz PCM WAV — it answers 500 for an MP3 —
 * so the browser decodes its own recording (it can play everything it recorded)
 * and re-encodes it as WAV before upload.
 *
 * 16 kHz mono is what ASR models are trained on, so this also halves the
 * upload size while making recognition more accurate.
 */

const TARGET_RATE = 16_000

/** Mono, 16-bit PCM WAV from any decodable blob. Returns null if unreadable. */
export async function toWav(blob: Blob): Promise<Blob | null> {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null

    const bytes = await blob.arrayBuffer()
    const ctx = new Ctor({ sampleRate: TARGET_RATE } as AudioContextOptions)
    let decoded: AudioBuffer
    try {
      decoded = await ctx.decodeAudioData(bytes.slice(0))
    } finally {
      void ctx.close().catch(() => {})
    }

    if (!decoded.length) return null
    const mixed = mixToMono(decoded)
    const samples = decoded.sampleRate === TARGET_RATE ? mixed : resample(mixed, decoded.sampleRate, TARGET_RATE)
    return encodeWav(samples, TARGET_RATE)
  } catch {
    return null
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  if (channels === 1) return buffer.getChannelData(0).slice()

  const out = new Float32Array(length)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i++) out[i] += data[i] / channels
  }
  return out
}

/** Linear resampler — speech recognition does not need anything fancier. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to
  const length = Math.floor(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const fraction = position - index
    const a = input[index] ?? 0
    const b = input[index + 1] ?? a
    out[i] = a + (b - a) * fraction
  }
  return out
}

/** 44-byte RIFF header + little-endian 16-bit samples. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }

  return new Blob([view], { type: 'audio/wav' })
}
