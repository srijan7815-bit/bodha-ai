/**
 * Offline study helper — used when the live model (moonshotai/kimi-k3 via
 * NVIDIA NIM) is not configured or cannot be reached. It keeps BODHA usable
 * end-to-end (identity answers, quick arithmetic, study frameworks) instead
 * of dead-ending the conversation.
 */

const CREATORS = 'Srijan Singh and Parv Mishra'

const CREATOR_REPLY = `I'm **BODHA AI**, built by ${CREATORS}.

I'm an educational assistant — I help students learn: explaining concepts, solving problems step by step, discussing uploaded documents, and writing or running code for learning purposes.

⚠️ My full teaching model (Kimi K3) isn't reachable right now, so I'm answering from my small offline helper — but everything else (library, reading, sandbox, voice) works normally.`

const HELP_REPLY = `Here's what you can do with BODHA:

- **Ask any academic question** — maths, sciences, history, languages, coding…
- **Upload a PDF or text** in the Library and ask me about it
- **Talk by voice** — tap the mic to dictate, or the speaker to hear answers
- **Run code** — my web examples have a ▶ Run button, and the Sandbox page has a full workbench

⚠️ My full teaching model (Kimi K3) isn't reachable right now, so deep tutoring is limited — but arithmetic, quick questions and all tools still work.`

function arithmetic(input: string): string | null {
  // Allow only digits, operators, parentheses, decimal points and spaces.
  if (!/^[\d+\-*/().\s^%]+$/.test(input)) return null
  if (!/\d/.test(input) || !/[+\-*/^%]/.test(input)) return null
  const expr = input.replace(/\^/g, '**')
  try {
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${expr});`)() as number
    if (typeof value !== 'number' || !isFinite(value)) return null
    const pretty = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)))
    return `\`${expr.replace(/\*\*/g, '^')}\` = **${pretty}**\n\n(want the *steps* too? I'll walk through them once my full model is back online)`
  } catch {
    return null
  }
}

const TOPIC_PRIMERS: Array<{ test: RegExp; reply: string }> = [
  {
    test: /photosynthesis/i,
    reply: `**Photosynthesis — the quick primer**

Plants make their own food from sunlight, water and carbon dioxide:

$$_{6}CO_2 + 6H_2O \\;\\xrightarrow{\\text{light}}\\; C_6H_{12}O_6 + 6O_2$$

1. **Light** is captured by chlorophyll in the leaves.
2. **Water** arrives from the roots; **CO₂** enters through tiny pores called stomata.
3. The chloroplasts convert them into **glucose** (the plant's fuel) and release **oxygen**.

Analogy: the leaf is a tiny solar-powered kitchen — sunlight is the stove, water and CO₂ are the ingredients, glucose is the meal.

Want me to go deeper (light vs. dark reactions) once my full model is back online?`,
  },
  {
    test: /quadratic/i,
    reply: `**Quadratic equations — the quick primer**

A quadratic has the form $ax^2 + bx + c = 0$. Solve with:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

The discriminant $D = b^2 - 4ac$ tells you about the roots:
- $D > 0$ → two real roots
- $D = 0$ → one repeated root
- $D < 0$ → no real roots (two complex ones)

Example: $x^2 - 5x + 6 = 0$ → $x = \\frac{5 \\pm \\sqrt{25-24}}{2}$ → $x = 3$ or $x = 2$.

I'll happily work through your specific equation step by step once my full model is back online.`,
  },
  {
    test: /pythagor/i,
    reply: `**Pythagoras' theorem — the quick primer**

In a right-angled triangle: $a^2 + b^2 = c^2$, where $c$ is the hypotenuse.

It's really about *areas*: draw a square on each side — the two small squares together have exactly the area of the big one. Want the visual proof? Ask me once my full model is back online and I'll draw it.`,
  },
]

export async function* streamDemoReply(userText: string, signal?: AbortSignal): AsyncGenerator<string> {
  const text = userText.trim()

  let reply: string
  if (/\b(who|whom)\b.*\b(made|created|built|designed|developed)\b/i.test(text) || /\bcreators?\b/i.test(text) || /^who are you$/i.test(text)) {
    reply = CREATOR_REPLY
  } else if (/^(help|what can you do|what do you do)/i.test(text)) {
    reply = HELP_REPLY
  } else if (/\b(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/i.test(text) && text.length < 40) {
    reply = `Namaste! 🪔 I'm **BODHA**, your study companion — built by ${CREATORS}.\n\nAsk me anything you're learning (or say "help"). Heads-up: my full Kimi K3 model is offline right now, so deep answers are limited.`
  } else {
    const math = arithmetic(text.replace(/^(what('s| is)|calculate|compute|solve)\s+/i, '').replace(/[?]/g, ''))
    if (math) {
      reply = math
    } else {
      const primer = TOPIC_PRIMERS.find(t => t.test.test(text))
      if (primer) {
        reply = primer.reply
      } else {
        reply = `I heard you — my full teaching model (Kimi K3) isn't reachable from this server right now, so I can only answer creator questions, simple arithmetic and a few primers offline.

Here's what still works perfectly while it recovers:
- 📖 the **Library** and the book-style PDF reader
- ⌨️ the **Sandbox** code workbench
- 🗣️ voice read-aloud and dictation
- 💾 your chat history (saved per-user)

Try me with something like "what is 17 * 23?" or ask "who made you?" — or come back shortly and ask your real question again.`
      }
    }
  }

  const full = reply
  const chunks = full.match(/[\s\S]{1,3}/g) ?? []
  for (const chunk of chunks) {
    if (signal?.aborted) return
    yield chunk
    await new Promise(r => setTimeout(r, 6))
  }
}
