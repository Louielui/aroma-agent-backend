'use strict'

const axios = require('axios')
const { LLMAdapter } = require('./LLMAdapter')

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
   *   model   — defaults to 'claude-3-5-haiku-20241022' (fast, cost-effective)
   *   apiKey  — defaults to process.env.ANTHROPIC_API_KEY (preferred)
   */
  constructor (config = {}) {
    super()
    // API key: env var takes precedence; constructor injection is for testing only.
    // NEVER pass a real key via constructor in production code.
    this._apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || ''
    this._model = config.model || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022'
    this._apiBase = 'https://api.anthropic.com/v1'
    this._anthropicVersion = '2023-06-01'
  }

  get providerName () {
    return 'anthropic-claude'
  }

  /**
   * @param {string} prompt
   * @param {{ maxTokens?: number, temperature?: number, system?: string }} [opts]
   * @returns {Promise<{ text: string, usage: object, model: string, latencyMs: number }>}
   */
  async complete (prompt, opts = {}) {
    if (!this._apiKey) {
      throw new Error(
        'ClaudeAdapter: ANTHROPIC_API_KEY is not set. ' +
        'Set it as an environment variable on Aroma Brain.'
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

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this._apiKey,         // key used here, never logged
      'anthropic-version': this._anthropicVersion
    }

    const t0 = Date.now()
    let response
    try {
      response = await axios.post(
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
      latencyMs
    }
  }
}

module.exports = { ClaudeAdapter }
