'use strict'

const axios = require('axios')
const { LLMAdapter } = require('./LLMAdapter')
const { assertResponseFormat } = require('./adapterErrors')

/**
 * ClaudeAdapter — concrete LLMAdapter implementation for Anthropic Claude.
 *
 * Security rules (conditions 1–4):
 *   - API key is read ONLY from process.env.ANTHROPIC_API_KEY.
 *   - The key is NEVER logged, echoed, or returned in any response.
 *   - The key is NEVER committed to source control (.env is gitignored).
 *
 * To swap this adapter for a different provider:
 *   1. Create a new class that extends LLMAdapter.
 *   2. Implement complete() and providerName.
 *   3. Register it in adapterFactory.js.
 *   Intake logic requires ZERO changes.
 */
class ClaudeAdapter extends LLMAdapter {
  /**
   * @param {{ model?: string, apiKey?: string }} [config]
   *   model   — explicit role pin, else CLAUDE_MODEL. There is NO built-in default.
   *   apiKey  — defaults to process.env.ANTHROPIC_API_KEY (preferred)
   */
  constructor (config = {}) {
    super()
    // API key: env var takes precedence; constructor injection is for testing only.
    // NEVER pass a real key via constructor in production code.
    this._apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || ''
    /**
     * ══════════════════════════════════════════════════════════════════════════
     * ⛔ NO HARDCODED MODEL. EXPLICIT PIN, THEN ENVIRONMENT, THEN NOTHING.
     *
     * This used to end `|| 'claude-3-5-haiku-20241022'`. That model is retired, so any process
     * that constructed this adapter WITHOUT the launcher — a canary, a script, a test harness,
     * a future service — silently selected a dead model and got HTTP 404 from Anthropic.
     * Measured, not theorised: it is exactly what blocked the A4-3B Stage 1 viability gate.
     *
     * The resident launcher happens to set CLAUDE_MODEL, so the live service never saw it. That
     * is the dangerous shape of this bug — a fallback nobody can observe until the one day the
     * launcher is not in the picture, and then the failure looks like a provider outage rather
     * than a line of source.
     *
     * ⛔ MODEL CHOICE IS DEPLOYMENT AND ROLE CONFIGURATION, NOT TRANSPORT'S BUSINESS. This class
     * speaks HTTP to Anthropic; it is not the authority on which model is current. A model
     * retirement must be a config change someone makes, never a hidden string someone has to
     * go and find.
     * ══════════════════════════════════════════════════════════════════════════
     */
    const pick = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : null
    this._model = pick(config.model) || pick(process.env.CLAUDE_MODEL) || null
    this._apiBase = 'https://api.anthropic.com/v1'
    this._anthropicVersion = '2023-06-01'
    // Injectable transport for tests ONLY. Production uses axios.post; the default
    // wrapper preserves axios semantics (returns { data }, throws with .response).
    this._post = (typeof config.transport === 'function')
      ? config.transport
      : ((url, data, cfg) => axios.post(url, data, cfg))
  }

  get providerName () {
    return 'anthropic-claude'
  }

  /**
   * @param {string} prompt
   * @param {{ maxTokens?: number, temperature?: number, system?: string }} [opts]
   * @returns {Promise<{ text: string, usage: object, model: string, latencyMs: number, stopReason: (string|null) }>}
   */
  async complete (prompt, opts = {}) {
    if (!this._apiKey) {
      throw new Error(
        'ClaudeAdapter: ANTHROPIC_API_KEY is not set. ' +
        'Set it as an environment variable on Aroma Brain.'
      )
    }

    /**
     * ⛔ FAIL CLOSED BEFORE THE NETWORK, AND NEVER SUBSTITUTE.
     *
     * No model means no request. The alternative — picking one — is what this repair removes:
     * a substituted model answers the Owner in a voice and at a price nobody chose, and it does
     * so invisibly. Refusing here costs one clear error message; guessing costs trust in every
     * answer that follows.
     *
     * ⛔ THE MESSAGE NAMES THE VARIABLE, NEVER A VALUE — same rule as the key check above.
     */
    if (!this._model) {
      throw new Error(
        'ClaudeAdapter: CLAUDE_MODEL is not set and no model was pinned by the caller. ' +
        'Set CLAUDE_MODEL, or construct the adapter with an explicit model.'
      )
    }

    const maxTokens = opts.maxTokens || 1024
    const temperature = opts.temperature !== undefined ? opts.temperature : 0.3

    const body = {
      model: this._model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'user', content: prompt }
      ]
    }

    if (opts.system) {
      body.system = opts.system
    }

    // Vendor-neutral structured output -> Anthropic GA output_config.format.
    // Validated BEFORE any network access (fail closed on a malformed contract).
    // The generic `name` is intentionally NOT transmitted (GA format = { type,
    // schema }); NO structured-outputs beta header is added.
    if (opts.responseFormat !== undefined && opts.responseFormat !== null) {
      assertResponseFormat(opts.responseFormat)
      body.output_config = {
        format: { type: 'json_schema', schema: opts.responseFormat.schema }
      }
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this._apiKey,         // key used here, never logged
      'anthropic-version': this._anthropicVersion
    }

    const t0 = Date.now()
    let response
    try {
      response = await this._post(
        `${this._apiBase}/messages`,
        body,
        { headers, timeout: 30000 }
      )
    } catch (err) {
      // Re-throw without leaking the API key in the error message
      const safeMsg = err.response
        ? `Claude API error ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : `Claude API network error: ${err.message}`
      throw new Error(safeMsg)
    }
    const latencyMs = Date.now() - t0

    const data = response.data
    const text = data.content?.[0]?.text || ''
    const usage = {
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
    }

    return {
      text,
      usage,
      model: data.model || this._model,
      latencyMs,
      // Provider-neutral completion reason, retained ONLY as the provider's short enum
      // (e.g. 'end_turn' | 'max_tokens' | 'stop_sequence'). It is the decisive evidence
      // that a reply was truncated rather than malformed. Never a response body; a
      // provider without an equivalent simply yields null.
      stopReason: (typeof data.stop_reason === 'string' && data.stop_reason) ? data.stop_reason : null
    }
  }
}

module.exports = { ClaudeAdapter }
