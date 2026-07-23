/**
 * LLMAdapter — swappable interface for all LLM providers.
 *
 * Intake logic depends ONLY on this interface. Replacing the underlying
 * model (Claude → GPT-4 → Gemini → local Ollama, etc.) requires ZERO
 * changes to intake logic — only a new concrete class that implements
 * this interface needs to be registered.
 *
 * Contract:
 *   complete(prompt: string, opts?: CompletionOptions): Promise<CompletionResult>
 *
 * CompletionOptions {
 *   maxTokens?: number   — upper bound on output tokens
 *   temperature?: number — 0.0–1.0 sampling temperature
 *   system?: string      — optional system-level instruction
 *   responseFormat?: {   — OPTIONAL vendor-neutral structured-output request
 *     type: 'json_schema',
 *     name: string,       — provider-neutral identifier; a provider MAY choose
 *                           not to transmit it (e.g. Anthropic GA does not)
 *     schema: object      — JSON Schema (additionalProperties:false on every object)
 *   }                     — An adapter that cannot honor responseFormat MUST fail
 *                           closed (UnsupportedCapabilityError); it must NEVER
 *                           silently ignore it and return unconstrained text.
 * }
 *
 * CompletionResult {
 *   text: string         — the model's text response
 *   usage: {
 *     inputTokens: number
 *     outputTokens: number
 *     totalTokens: number
 *   }
 *   model: string        — canonical model identifier used for this call
 *   latencyMs: number    — wall-clock milliseconds for the API round-trip
 * }
 */
class LLMAdapter {
  /**
   * @param {string} prompt
   * @param {{ maxTokens?: number, temperature?: number, system?: string }} [opts]
   * @returns {Promise<{ text: string, usage: { inputTokens: number, outputTokens: number, totalTokens: number }, model: string, latencyMs: number }>}
   */
  // eslint-disable-next-line no-unused-vars
  async complete (prompt, opts = {}) {
    throw new Error(
      `LLMAdapter.complete() is abstract. ` +
      `Implement it in a concrete subclass (e.g. ClaudeAdapter).`
    )
  }

  /**
   * Returns the canonical provider name for logging/metrics.
   * @returns {string}
   */
  get providerName () {
    throw new Error('LLMAdapter.providerName is abstract.')
  }
}

module.exports = { LLMAdapter }
