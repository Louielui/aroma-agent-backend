'use strict'

const { ClaudeAdapter } = require('./ClaudeAdapter')
const { MockAdapter } = require('./MockAdapter')

/**
 * adapterFactory — central registry for LLM provider adapters.
 *
 * To add a new provider (e.g. OpenAI, Gemini, local Ollama):
 *   1. Create MyAdapter extends LLMAdapter in this directory.
 *   2. Add an entry to REGISTRY below.
 *   3. Set LLM_PROVIDER=<key> in your .env.
 *   Intake logic requires ZERO changes.
 *
 * @type {Record<string, () => import('./LLMAdapter').LLMAdapter>}
 */
const REGISTRY = {
  claude: () => new ClaudeAdapter(),
  mock: () => new MockAdapter(),
  // Future providers — uncomment and implement:
  // openai:  () => new OpenAIAdapter(),
  // gemini:  () => new GeminiAdapter(),
  // ollama:  () => new OllamaAdapter(),
}

/**
 * Returns the active LLMAdapter instance based on LLM_PROVIDER env var.
 * Defaults to 'claude' if not set.
 *
 * @returns {import('./LLMAdapter').LLMAdapter}
 */
function getAdapter () {
  const provider = (process.env.LLM_PROVIDER || 'claude').toLowerCase()
  const factory = REGISTRY[provider]
  if (!factory) {
    throw new Error(
      `adapterFactory: unknown LLM_PROVIDER="${provider}". ` +
      `Registered providers: ${Object.keys(REGISTRY).join(', ')}`
    )
  }
  return factory()
}

module.exports = { getAdapter, REGISTRY }
