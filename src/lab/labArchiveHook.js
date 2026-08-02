'use strict'

/**
 * labArchiveHook.js — the ONE place the Lab archive touches the live conversation path.
 *
 * ── WHY A SEPARATE FILE ────────────────────────────────────────────────────
 * So that "what did the Lab change in Xiangxiang?" has a one-file answer, and so the flag-off
 * behaviour can be asserted structurally rather than by reading the router.
 *
 * ── FLAG OFF MEANS NOTHING HAPPENS. NOT "NOTHING IS WRITTEN". ──────────────
 * With XIANGXIANG_ARCHIVE unset or anything other than 'on', this returns immediately, having
 * required no module, opened no file, created no directory and touched no disk. The archive
 * module is `require`d INSIDE the enabled branch, so with the flag off it is never even loaded
 * into the process — the same structural test the Computer Operator wiring uses.
 *
 * ── IT CANNOT BREAK A CONVERSATION ────────────────────────────────────────
 * Every path returns a value. Nothing throws. The caller is expected to attach the result to its
 * response for visibility and to carry on regardless — see the fail-OPEN reasoning in
 * conversationArchive.js.
 *
 * ── THIRD-PARTY DATA: OWNER DECISION A′ (2026-08-02) ──────────────────────
 * The first real conversation was a Gmail lookup. The retrieved mail never entered the archive —
 * the context card and the read block are not passed here and never were — but the ASSISTANT'S
 * REPLY quoted it, and a reply is stored verbatim. So other people's names and business landed
 * in the Owner's archive through the answer rather than through the data.
 *
 * A′: when a turn actually used external read context, the user's own words are kept and the
 * assistant's body is NOT stored. In its place goes an omission record — same position, same
 * order, same provenance, no content. The archive stays honest about the shape of the
 * conversation without holding a third party's information.
 *
 * ── TWO OPPOSITE DEFAULTS, ON PURPOSE ─────────────────────────────────────
 * Writing is fail-OPEN: if the archive cannot be written, the conversation still completes.
 * Third-party data is fail-SAFE: if we cannot tell whether external context was used, the body
 * is OMITTED.
 *
 * They point opposite ways because the costs are not symmetric. A missing record costs a note
 * nobody can read later. A wrongly-kept record puts someone else's mail on a disk that has no
 * backup, no readback design and no consent — and unlike a missing note, it cannot be undone by
 * noticing. So: never let the archive break a conversation, and never let a doubt keep a
 * stranger's data.
 */

/** The flag, resolved the same strict way the Computer Operator flag is: exactly 'on'. */
function archiveEnabled (env) {
  const raw = (env || process.env).XIANGXIANG_ARCHIVE
  return raw === 'on'
}

/**
 * Record one exchange — the user's message and the assistant's reply.
 *
 * @param {object} input
 * @param {string} input.conversationId
 * @param {string} input.message      the user's text, verbatim
 * @param {string} [input.reply]      the assistant's text, verbatim
 * @param {number} input.turnIndex    index of the USER turn; the reply takes turnIndex + 1
 * @param {string} [input.model] [input.provider] [input.lane] [input.requestId]
 * @param {boolean} [input.readContextUsed]      MUST be a real boolean from the pipeline.
 *                                               Anything else (undefined, null, 'false') is
 *                                               treated as UNKNOWN and the body is omitted.
 * @param {string[]} [input.readContextSources]  source KINDS only
 * @param {object} [input.env] [input.archive] injected for tests
 * @returns {{recorded:boolean, reason?:string, ids?:string[], failures?:object[], assistantOmitted?:boolean}}
 */
function recordExchange (input = {}) {
  try {
    if (!archiveEnabled(input.env)) return { recorded: false, reason: 'flag_off' }

    // Required INSIDE the enabled branch. With the flag off these modules are never loaded.
    const { createConversationArchive } = require('./conversationArchive')
    const { saysDoNotRecord } = require('./redaction')

    const archive = input.archive || createConversationArchive({ root: input.root })

    // The opt-out is read from the USER's words only. An assistant reply that says "I won't
    // record this" must not be able to suppress the record — the instruction is the person's.
    const optOut = saysDoNotRecord(input.message)

    const base = {
      conversationId: input.conversationId,
      model: input.model,
      provider: input.provider,
      lane: input.lane,
      requestId: input.requestId,
      userAskedNotToRecord: optOut
    }

    // A′ — FAIL-SAFE. The body is kept ONLY on an explicit `false`. `undefined` means the
    // pipeline did not report, which is a doubt, and a doubt omits. Note that this is a
    // one-way default: a pipeline that stops reporting quietly loses assistant bodies, which
    // is visible in the archive; the opposite mistake would be invisible.
    const omitAssistantBody = input.readContextUsed !== false

    const results = []
    // THE USER'S OWN WORDS ARE ALWAYS KEPT. The Owner asking about his mail is the Owner's
    // data; it is the ANSWER that carries other people's.
    results.push(archive.appendTurn(Object.assign({}, base, {
      role: 'user', text: input.message, turnIndex: input.turnIndex
    })))
    if (typeof input.reply === 'string' && input.reply.length > 0) {
      const assistantTurn = Object.assign({}, base, {
        role: 'assistant',
        turnIndex: (Number.isInteger(input.turnIndex) ? input.turnIndex + 1 : null)
      })
      if (omitAssistantBody) {
        // input.reply IS NOT PASSED. The omission is structural, not a promise made by the
        // writer: the text never reaches the function that writes files.
        assistantTurn.omitBody = true
        assistantTurn.omissionReason = 'external_read_context'
        assistantTurn.readContextSources = Array.isArray(input.readContextSources) ? input.readContextSources : []
      } else {
        assistantTurn.text = input.reply
      }
      results.push(archive.appendTurn(assistantTurn))
    }

    const failures = results.filter((r) => r.ok === false)
    const ids = results.filter((r) => r.written).map((r) => r.id)

    if (optOut) return { recorded: false, reason: 'owner_asked_not_to_record' }
    if (failures.length > 0) {
      return { recorded: false, reason: failures[0].reason, failures: failures.map((f) => ({ reason: f.reason, error: f.error || null })) }
    }
    // assistantOmitted travels back to the response so the Owner can see, per turn, that a
    // reply was not kept — the same visibility rule as a write failure.
    return { recorded: true, ids, assistantOmitted: omitAssistantBody }
  } catch (err) {
    // The last net. Nothing about the Lab may reach the conversation as an exception.
    return { recorded: false, reason: 'hook_failed', failures: [{ reason: 'hook_failed', error: err && err.message ? err.message : String(err) }] }
  }
}

module.exports = { recordExchange, archiveEnabled }
