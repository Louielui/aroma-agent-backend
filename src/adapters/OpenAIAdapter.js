'use strict'

/**
 * OpenAIAdapter.js — Multi-AI Router v0. A second concrete LLMAdapter, so the
 * vendor-neutral seam is proven by a real alternative provider rather than asserted.
 *
 * VERIFIED AGAINST THE OFFICIAL DOCS (2026-07-25), not from memory:
 *   endpoint : POST https://api.openai.com/v1/responses
 *   request  : { model, input, instructions, max_output_tokens, store, temperature }
 *              - `instructions` is the system/developer message inserted into context
 *              - `max_output_tokens` bounds ALL generated tokens (incl. reasoning)
 *   response : { status, incomplete_details:{reason}, output[], usage{input_tokens,
 *              output_tokens,total_tokens}, model }
 *              - assistant text lives at output[i].content[j].text where the content
 *                part has type 'output_text' (documented path: output[0].content[0].text)
 *              - status ∈ 'in_progress' | 'completed' | 'incomplete'
 *              - incomplete_details.reason ∈ 'max_output_tokens' | 'content_filter'
 *
 * DATA HANDLING — honest, not a zero-retention claim:
 *   Every request sets `store: false`, so Aroma deliberately creates no retrievable
 *   Application State (the Responses API otherwise retains it for at least 30 days).
 *   That is NOT zero retention: per the docs, "abuse monitoring logs are generated for
 *   all API feature usage and retained for up to 30 days, unless longer retention is
 *   required by law…", and those logs "may contain certain customer content, such as
 *   prompts and responses". Excluding content from them requires Zero Data Retention or
 *   Modified Abuse Monitoring, which are "subject to prior approval by OpenAI and
 *   acceptance of additional requirements".
 *
 * SAFETY / SCOPE (v0):
 *   - NO tools, NO function calling, NO JSON-mode/structured-output helper. The existing
 *     strict envelope parser is untouched and remains the only contract.
 *   - Model comes from OPENAI_MODEL; a missing/empty value makes the adapter UNAVAILABLE
 *     (fail-closed). A model id is never hardcoded.
 *   - The API key is read from OPENAI_API_KEY at call time and is never logged, echoed,
 *     returned, or written to disk.
 *   - Uses the repo's existing axios — no new dependency.
 */

const axios = require('axios')
const { LLMAdapter } = require('./LLMAdapter')

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_TIMEOUT_MS = 60000
// Docs: GPT-5.6 "supports none, low, medium, high, xhigh, and max"; omitted -> "defaults
// to medium". The guide also warns "Some models support only a subset of these values, so
// check the relevant model page" — and the gpt-5.6-terra model page does NOT publish its
// accepted set, so per-variant support is UNVERIFIED.
//
// DEFAULT CHOICE = 'low' (changed from 'none'). Rationale: 'none' is unverified for terra
// and a rejected value costs a 400 + a fallback round-trip; 'medium' is the only value
// provably accepted (it is the documented default) but it burns the most reasoning tokens
// against the 2048 chat budget — the exact risk this guard exists to remove. 'low' is
// documented at the family level and is the guide's recommendation for latency-sensitive
// workloads, so it is the safest documented middle. If terra rejects it, the new provider
// diagnostics name the parameter and OPENAI_REASONING_EFFORT changes it without a deploy.
const DEFAULT_REASONING_EFFORT = 'low'
const VALID_REASONING_EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/**
 * Normalize the provider's completion signal onto the neutral vocabulary already used
 * by ClaudeAdapter/diagnostics ('end_turn' | 'max_tokens' | …). This is a documented
 * MAPPING of a real provider field, not an invented one; when OpenAI reports nothing
 * usable the result is null.
 */
function normalizeStopReason (data) {
  const status = data && data.status
  const reason = data && data.incomplete_details && data.incomplete_details.reason
  if (status === 'incomplete') {
    if (reason === 'max_output_tokens') return 'max_tokens' // same meaning as Anthropic's
    if (typeof reason === 'string' && reason) return reason // e.g. 'content_filter'
    return 'incomplete'
  }
  if (status === 'completed') return 'end_turn'
  return null
}

/** Extract the assistant text: the documented output[] → content[] → text path. */
function extractText (data) {
  const out = data && Array.isArray(data.output) ? data.output : []
  const parts = []
  for (const item of out) {
    const content = item && Array.isArray(item.content) ? item.content : []
    for (const c of content) {
      if (c && typeof c.text === 'string' && (c.type === 'output_text' || c.type === undefined)) parts.push(c.text)
    }
  }
  return parts.join('')
}

class OpenAIAdapter extends LLMAdapter {
  constructor (options = {}) {
    super()
    this._model = options.model || null
    this._apiKey = options.apiKey || null
    this._timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    // null/'' → omit the field entirely (provider default applies).
    this._reasoningEffort = (options.reasoningEffort === undefined) ? DEFAULT_REASONING_EFFORT : options.reasoningEffort
    // Injectable transport for tests ONLY; production uses axios.post.
    this._post = typeof options.post === 'function' ? options.post : ((url, body, cfg) => axios.post(url, body, cfg))
  }

  /**
   * @param {string} prompt   the user-turn payload
   * @param {{ system?: string, maxTokens?: number, temperature?: number }} [opts]
   * @returns {Promise<{ text, usage, model, latencyMs, stopReason }>} same shape as ClaudeAdapter
   */
  async complete (prompt, opts = {}) {
    if (!this._model) throw new Error('OpenAI adapter unavailable: OPENAI_MODEL is not set')
    const apiKey = this._apiKey || process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OpenAI adapter unavailable: OPENAI_API_KEY is not set')

    // MINIMUM VIABLE BODY. Reasoning models reject sampling parameters: a GPT-5-family
    // request carrying `temperature` fails with HTTP 400 — "Unsupported parameter:
    // 'temperature' is not supported for these models and only the default (1) value is
    // supported" — and `top_p` behaves the same way. That unconditional temperature is
    // what made every Stage-2 GPT attempt throw before returning text. The neutral
    // LLMAdapter contract still ACCEPTS opts.temperature (Claude uses it); this adapter
    // simply does not forward it. Nothing is sent "just in case".
    const body = {
      model: this._model,
      input: prompt,
      max_output_tokens: opts.maxTokens || 1024,
      store: false // never create retrievable Application State
    }
    if (opts.system) body.instructions = opts.system
    // REASONING BUDGET GUARD (GPT-5.6 family). Verified from the docs: reasoning tokens
    // are billed as output tokens AND count against max_output_tokens, and effort
    // defaults to 'medium' when omitted — so on a 2048-token chat budget the reasoning
    // pass alone can consume the allowance, returning status 'incomplete' with little or
    // no visible text (→ envelope parse failure → fallback → two billed calls per turn).
    // The distill lane is conversational + classification, not a reasoning task, so the
    // effort is pinned LOW-EST here and stays operator-overridable via env.
    const effort = opts.reasoningEffort !== undefined ? opts.reasoningEffort : this._reasoningEffort
    if (effort) body.reasoning = { effort }

    const t0 = Date.now()
    let response
    try {
      response = await this._post(OPENAI_RESPONSES_URL, body, {
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        timeout: this._timeoutMs
      })
    } catch (err) {
      // Never surface the provider body/headers (they can echo the prompt). We attach an
      // ALLOWLIST of three short diagnostic fields — HTTP status plus the provider's own
      // error `type` and `code` enums — so a failure is explainable without ever carrying
      // content. A provider that omits them yields null, never an invented value.
      const res = err && err.response
      const perr = res && res.data && res.data.error
      const e = new Error(`OpenAI request failed${res && res.status ? ` (HTTP ${res.status})` : ''}`)
      e.providerDiagnostics = {
        httpStatus: (res && Number.isFinite(res.status)) ? res.status : null,
        errorType: (perr && typeof perr.type === 'string') ? perr.type : null,
        errorCode: (perr && typeof perr.code === 'string') ? perr.code : null,
        errorParam: (perr && typeof perr.param === 'string') ? perr.param : null // e.g. 'temperature'
      }
      throw e
    }
    const latencyMs = Date.now() - t0
    const data = (response && response.data) || {}

    return {
      text: extractText(data),
      usage: {
        inputTokens: (data.usage && data.usage.input_tokens) || 0,
        outputTokens: (data.usage && data.usage.output_tokens) || 0,
        totalTokens: (data.usage && data.usage.total_tokens) ||
          (((data.usage && data.usage.input_tokens) || 0) + ((data.usage && data.usage.output_tokens) || 0)),
        // Documented path usage.output_tokens_details.reasoning_tokens — surfaced so a
        // budget-exhaustion can be PROVEN from the logs rather than inferred. Absent on
        // non-reasoning models / providers → 0.
        reasoningTokens: (data.usage && data.usage.output_tokens_details && data.usage.output_tokens_details.reasoning_tokens) || 0
      },
      model: data.model || this._model,
      latencyMs,
      stopReason: normalizeStopReason(data)
    }
  }
}

/**
 * Build the adapter ONLY when both env vars are present; otherwise return null so the
 * router falls back to Claude without ever attempting a call. Fail-closed by design.
 */
function createOpenAIAdapterIfConfigured (env = process.env, options = {}) {
  const model = env.OPENAI_MODEL
  const apiKey = env.OPENAI_API_KEY
  if (typeof model !== 'string' || model.trim() === '') return null
  if (typeof apiKey !== 'string' || apiKey.trim() === '') return null
  // OPENAI_REASONING_EFFORT overrides the pinned default. An unrecognised value is
  // IGNORED (fall back to the safe default) rather than forwarded — a typo must never
  // become a provider 400 that costs a fallback round-trip.
  const raw = env.OPENAI_REASONING_EFFORT
  let reasoningEffort = DEFAULT_REASONING_EFFORT
  if (typeof raw === 'string' && raw.trim() !== '') {
    const v = raw.trim()
    if (VALID_REASONING_EFFORTS.includes(v)) reasoningEffort = v
    else console.warn(`[AROMA-HUB] Invalid OPENAI_REASONING_EFFORT="${v}" — using '${DEFAULT_REASONING_EFFORT}'.`)
  }
  return new OpenAIAdapter(Object.assign({ model: model.trim(), apiKey, reasoningEffort }, options))
}

module.exports = {
  OpenAIAdapter,
  createOpenAIAdapterIfConfigured,
  normalizeStopReason,
  extractText,
  OPENAI_RESPONSES_URL,
  DEFAULT_REASONING_EFFORT,
  VALID_REASONING_EFFORTS
}
