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

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ C3 — THE CHAT BRAIN'S MODEL IS ITS OWN SETTING, NOT THE ACCOUNT'S SETTING.
 *
 * `CLAUDE_MODEL` is one value holding six jobs at once. Traced at f706ca88, it currently
 * decides the chat brain, the goal decomposer inside that same turn, the email-draft lane,
 * the proposal / work-order lane, the intent classifier that CREATES proposals, and the
 * knowledge worker that executes a dispatch. Raising the chat brain by editing that one
 * value would silently re-point every one of them — including two that carry work-order
 * authority and one that runs a task.
 *
 * ⛔ SO THE CANARY GETS ITS OWN KNOB, AND IT FAILS BACK RATHER THAN OPEN. Unset, blank or
 * whitespace `CLAUDE_CHAT_MODEL` returns `getAdapter()` — the same object this caller has
 * always received. Rollback is therefore the ABSENCE of a value plus a restart: no code
 * revert, no archaeology, and no way for a half-applied change to leave the chat lane on a
 * model nobody chose.
 *
 * ⛔ AND IT NEVER SUBSTITUTES A PROVIDER. With `LLM_PROVIDER` set to anything but claude the
 * pin is ignored outright — a model name must never be able to turn a mock, or a future
 * provider, into a live Anthropic client. This picks a MODEL for an already-selected
 * provider; it is not a second router, and it reads nothing a browser can send.
 *
 * ⛔ ONE LANE, BY NAME AND EXACTLY. Every other lane takes the untouched `getAdapter()`
 * path, so the proposal and email_draft shapes cannot inherit a chat experiment by
 * accident, by casing, or by a stray space.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const CHAT_LANE = 'chat'
const CHAT_MODEL_ENV = 'CLAUDE_CHAT_MODEL'

/**
 * @param {string} [lane] the router-validated interactionMode; anything but CHAT_LANE is unaffected
 * @returns {import('./LLMAdapter').LLMAdapter}
 */
function getAdapterForLane (lane) {
  if (lane !== CHAT_LANE) return getAdapter()
  const provider = (process.env.LLM_PROVIDER || 'claude').toLowerCase()
  if (provider !== 'claude') return getAdapter()
  const pinned = process.env[CHAT_MODEL_ENV]
  const model = (typeof pinned === 'string' && pinned.trim() !== '') ? pinned.trim() : null
  if (!model) return getAdapter()
  return new ClaudeAdapter({ model })
}

module.exports = { getAdapter, getAdapterForLane, REGISTRY, CHAT_LANE, CHAT_MODEL_ENV }
