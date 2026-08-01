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
 * @param {object} [input.env] [input.archive] injected for tests
 * @returns {{recorded:boolean, reason?:string, ids?:string[], failures?:object[]}}
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

    const results = []
    results.push(archive.appendTurn(Object.assign({}, base, {
      role: 'user', text: input.message, turnIndex: input.turnIndex
    })))
    if (typeof input.reply === 'string' && input.reply.length > 0) {
      results.push(archive.appendTurn(Object.assign({}, base, {
        role: 'assistant', text: input.reply, turnIndex: (Number.isInteger(input.turnIndex) ? input.turnIndex + 1 : null)
      })))
    }

    const failures = results.filter((r) => r.ok === false)
    const ids = results.filter((r) => r.written).map((r) => r.id)

    if (optOut) return { recorded: false, reason: 'owner_asked_not_to_record' }
    if (failures.length > 0) {
      return { recorded: false, reason: failures[0].reason, failures: failures.map((f) => ({ reason: f.reason, error: f.error || null })) }
    }
    return { recorded: true, ids }
  } catch (err) {
    // The last net. Nothing about the Lab may reach the conversation as an exception.
    return { recorded: false, reason: 'hook_failed', failures: [{ reason: 'hook_failed', error: err && err.message ? err.message : String(err) }] }
  }
}

module.exports = { recordExchange, archiveEnabled }
