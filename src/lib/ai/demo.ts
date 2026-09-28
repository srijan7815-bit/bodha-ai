/**
 * Demo fallback when no AI provider is configured.
 * Streams a canned response character by character.
 */

export async function* streamDemoReply(userText: string, signal?: AbortSignal): AsyncGenerator<string> {
  const responses = [
    "I'm running in demo mode — no AI provider configured. To enable the real tutor, set NVIDIA_API_KEY in your .env file.",
    "In the meantime, here's a quick example of how I'd help:",
    "",
    "**Example: Explaining photosynthesis**",
    "Photosynthesis is how plants make their own food using sunlight. Think of a leaf as a tiny solar-powered kitchen:",
    "",
    "1. **Sunlight** hits chlorophyll (the green pigment) — this is the energy source",
    "2. **Water** is absorbed by roots and travels up to the leaves",
    "3. **Carbon dioxide** enters through tiny pores (stomata) on the leaf underside",
    "4. In the **chloroplasts**, light energy drives a reaction: CO₂ + H₂O → glucose + O₂",
    "",
    "The plant uses glucose for growth and releases oxygen — which we breathe! 🌱",
    "",
    "Does that help? Try asking me about quadratic equations, Spanish vocabulary, or a coding concept!",
  ]

  const full = responses.join('\n')
  for (const char of full) {
    if (signal?.aborted) return
    yield char
    // Small delay to simulate streaming
    await new Promise(r => setTimeout(r, 8))
  }
}