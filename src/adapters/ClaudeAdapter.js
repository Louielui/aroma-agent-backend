'use strict'

const axios = require('axios')
const { LLMAdapter } = require('./LLMAdapter')
const { assertResponseFormat } = require('./adapterErrors')

/**
 * ⛔ THE CEILING ON OUR PATIENCE, NOT ON HER THINKING.
 *
 * Named rather than inlined because it is quoted to the Owner when it is reached — 「超過 30
 * 秒未答完」 is only checkable if the number has one home.
 *
 * ⛔ 30000 -> 120000, and only after it started telling the truth. The Owner's ruling was that
 * order: a longer timeout that still reports 「failed」 tells the same untruth later, so the
 * `isTimeout` flag shipped first and the ceiling moved second.
 *
 * MEASURED before choosing, single call, 8192-token budget, same prompt and schema:
 *
 *   claude-opus-5   7.6s · 30.9s · 46.8s · 65.1s   (thinking+text on all but the shortest)
 *   haiku-4-5       7.8s
 *
 * 120s is ~1.85x the slowest observation. 90s was rejected: at 1.38x it sits inside the noise
 * of a four-point sample whose range spans eight-fold, and it would have risked repeating the
 * whole exercise. It also reuses the startup smoke test's existing ceiling rather than adding a
 * second number to the system.
 *
 * ⚠ THE TAIL IS NOT CHARACTERISED. Four points are a range, not a distribution, and latency
 * tracks THINKING, which tracks question difficulty — an axis sampled at three values. A breach
 * now reports itself as `isTimeout` rather than as a failure, which is what makes an
 * under-estimate survivable.
 *
 * ⚠ AND NO CEILING FIXES `Overloaded`. The provider's own overload is a separate arrival shape,
 * observed once, and it needs a retry policy this system does not have.
 */
const REQUEST_TIMEOUT_MS = 120000

/**
 * Did this fail because we stopped waiting? Axios reports its own timeout as `ECONNABORTED`
 * with a message naming the value; `ETIMEDOUT` is the socket-level equivalent. Both are matched
 * because they mean the same thing to the Owner, and neither means the model failed.
 */
function isTimeout (err) {
  if (!err) return false
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return true
  return typeof err.message === 'string' && /timeout of \d+ms exceeded/i.test(err.message)
}

/**
 * Block types this adapter knows how to see. Anything else is an ERROR, never silence.
 *
 * `thinking` and `redacted_thinking` are a reasoning model's private working. They are not the
 * answer and are never returned as one — but they are EXPECTED, so encountering them is not a
 * failure by itself. Running out of budget inside them is.
 */
const TEXT_BLOCK = 'text'
const THINKING_BLOCKS = Object.freeze(['thinking', 'redacted_thinking'])

/**
 * ⛔ EVERY BLOCK, AND AN UNREADABLE RESPONSE IS AN ERROR — NOT AN EMPTY STRING.
 *
 * This was `data.content?.[0]?.text || ''`: the FIRST block, assumed to be text, with `|| ''`
 * catching everything it did not understand.
 *
 * `claude-opus-5` returns a `thinking` block. Measured, same prompt, same schema, same
 * `max_tokens: 2048`:
 *
 *   opus-5  stop: max_tokens  out: 2048  content[0] type=thinking  hasText=false
 *   haiku   stop: end_turn    out:  633  content[0] type=text      len=1120
 *
 * So the adapter yielded `''`, the parser said `empty_response`, the loop boundary printed that
 * failure as a completed answer (HR-67), the renderer recorded 「the model returned no plan」 —
 * and a model was characterised for a week on the strength of it. Five layers, each correct on
 * its input, converting 「we cannot read this」 into 「the model is worse」. (HR-68, HR-69.)
 *
 * ⛔ `|| ''` IS THE SAME SHAPE AS `|| []` AND AS A SILENT `NO_EVIDENCE`: silence in the place
 * where the truth was 「I could not read this」. An adapter that cannot understand a response
 * must say so, loudly, with the shape it saw.
 */
function extractText (data, model) {
  const blocks = Array.isArray(data && data.content) ? data.content : null
  if (!blocks) {
    const e = new Error('Claude response carried no content array — cannot read this response')
    e.unreadableResponse = true
    throw e
  }

  const kinds = blocks.map((b) => (b && typeof b.type === 'string') ? b.type : 'unknown')
  const text = blocks
    .filter((b) => b && b.type === TEXT_BLOCK && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')

  if (text) return text

  // ⛔ NO TEXT. Say WHICH of the reasons it was, because they need different responses.
  const onlyThinking = kinds.length > 0 && kinds.every((k) => THINKING_BLOCKS.includes(k))
  const e = new Error(onlyThinking
    // The most actionable message in this file: the budget is the fix, not the model.
    ? `Claude returned only reasoning blocks and no answer (stop_reason=${data.stop_reason || 'unknown'}, model=${model || 'unknown'}) — the token budget was spent thinking`
    : `Claude response had no readable text block (blocks: ${kinds.join(', ') || 'none'}, stop_reason=${data.stop_reason || 'unknown'})`)
  e.unreadableResponse = true
  e.blockKinds = kinds
  e.spentOnThinking = onlyThinking
  throw e
}

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

    /**
     * ⛔ NO SAMPLING PARAMETER IS SENT. THE SIBLING ADAPTER LEARNED THIS FIRST.
     *
     * `OpenAIAdapter` carries the note a few files away: reasoning models reject sampling
     * parameters outright, and an unconditional `temperature` made every Stage-2 GPT attempt
     * throw before returning text. The same lesson was never applied here, and on the first
     * restart onto `claude-opus-5` the startup smoke test came back:
     *
     *   Claude API error 400: `temperature` is deprecated for this model.
     *
     * ⛔ AND THE VALUE WAS NEVER CHOSEN BY ANYONE. `0.3` was this adapter's own default,
     * applied to every call that did not name one — the chat lane, the proposal lane, the
     * dispatcher. No caller asked for it and no test asserted it; it was simply what the
     * body had always contained.
     *
     * The neutral `LLMAdapter` contract still ACCEPTS `opts.temperature`. This adapter no
     * longer forwards it, in either direction: nothing is sent 「just in case」, and an
     * explicit request for one is not quietly honoured on a model that refuses it. A caller
     * that needs determinism gets it from the schema and the parser, which reject a
     * wrong-shaped answer whatever the sampler did.
     */
    const body = {
      model: this._model,
      max_tokens: maxTokens,
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
        { headers, timeout: REQUEST_TIMEOUT_MS }
      )
    } catch (err) {
      // Re-throw without leaking the API key in the error message
      const safeMsg = err.response
        ? `Claude API error ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : `Claude API network error: ${err.message}`
      const e = new Error(safeMsg)

      /**
       * ⛔ A TIMEOUT IS NOT A FAILURE. IT IS US DECIDING TO STOP WAITING.
       *
       * > **Owner: 「『佢仲喺度諗』 is a different fact from 『失敗咗』 and only one of them is
       * > true. I would rather wait than be told nothing happened.」**
       *
       * Until now a timeout arrived as `Claude API network error: timeout of 30000ms
       * exceeded` — the same shape as a refused schema, a dropped connection and an invalid
       * key. Every one of those means the model produced nothing. A timeout means the model
       * was still working and WE gave up: the only party that failed was the caller's
       * patience, and the answer may well have completed a second later.
       *
       * Flagged here so the layers above can say which happened. ⛔ AND THE FLAG IS SET
       * BEFORE ANY THOUGHT OF RAISING THE CEILING: a longer timeout that still reports
       * 「failed」 just tells the same untruth later.
       */
      if (isTimeout(err)) {
        e.isTimeout = true
        e.timeoutMs = REQUEST_TIMEOUT_MS
      }
      throw e
    }
    const latencyMs = Date.now() - t0

    const data = response.data
    const text = extractText(data, this._model)
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
