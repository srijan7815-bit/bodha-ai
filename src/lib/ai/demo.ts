/**
 * Offline study helper.
 *
 * BODHA must never be a blank page. When no model is reachable at all (no key,
 * provider outage, airplane mode on a school laptop) this generator produces a
 * genuinely useful study scaffold: how to break the question down, a plan, and
 * something to try next. It is honest about being offline.
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const PATTERNS: Array<{ test: RegExp; reply: (q: string) => string }> = [
  {
    test: /(solve|calculate|evaluate|find|prove|derivative|integral|equation)/i,
    reply: q => `I cannot reach my teaching models right now, so here is how I would work through **“${q}”** myself.

**1. Name the type of problem**
Write down what you are given, what is asked, and which chapter this belongs to. Most mistakes at this stage are actually misread questions.

**2. Choose one tool**
Only one formula or method should be needed. Say out loud *why* it applies — if you cannot, re-read the question.

**3. Work in small lines**
One change per line, units or signs kept visible. Correct work is easy to check; clever work is not.

**4. Sanity-check the answer**
Estimate first. Does the size, sign and unit make sense for the situation?

Tell me the exact question (and any diagram) once I am back online and I will solve it line by line with you.`
  },
  {
    test: /(explain|what is|why|how does|define|meaning of|difference between)/i,
    reply: q => `My models are offline at the moment, so instead of guessing at **“${q}”**, here is a study frame you can fill in — and I will complete it properly as soon as I am back.

**Definition** — say what it *is* in one sentence, in your own words.
**Why it exists** — what problem was it invented to solve?
**How it works** — the mechanism, in 3–4 steps, in order.
**Example** — one concrete case from real life or a textbook.
**Where it breaks** — assumptions and edge cases. This is where exam questions usually hide.
**Connects to** — the two neighbouring topics it links to in your syllabus.

Write your attempt in the composer and send it — I will mark it and correct the details.`
  },
  {
    test: /(quiz|test me|ask me|practice questions)/i,
    reply: () => `My question bank is offline right now, so here is the pattern I use — try it on any chapter you are revising.

1. **Recall:** define today's key term in two lines.
2. **Apply:** give one everyday example and explain it.
3. **Stretch:** invent one question an examiner could ask, and answer it.
4. **Fix:** write down the one thing you got wrong yesterday.

Send me your answers and I will mark them the moment my models are back.`
  },
]

const FALLBACK = (q: string) => `I am offline at the moment — my teaching models are unreachable — so I will not pretend to answer **“${q}”** properly.

While I am away:
- Restate the question in your own words (this alone often reveals the gap).
- Write what you already know about it, in bullet points.
- Note the precise point where you get stuck.

Send that to me and it will be waiting: the moment my models are back I will answer fully, step by step.`

function pickReply(question: string): string {
  for (const { test, reply } of PATTERNS) {
    if (test.test(question)) return reply(question)
  }
  return FALLBACK(question)
}

export async function* streamDemoReply(question: string, signal?: AbortSignal): AsyncGenerator<string> {
  const text = pickReply(question.trim() || 'your question')
  const tokens = text.match(/\s*\S+/g) ?? []
  for (const token of tokens) {
    if (signal?.aborted) return
    yield token
    await sleep(8)
  }
}
