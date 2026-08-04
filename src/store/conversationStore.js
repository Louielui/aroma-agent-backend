'use strict'

/**
 * conversationStore.js — conversation history that survives a refresh.
 *
 * WHY IT EXISTS. The sidebar had 「開新對話」 and nothing to go back to: every conversation
 * lived in the page, so a refresh or a new chat discarded it. Only the last turns the
 * client happened to be holding existed at all.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ─────────────────────────────────────────
 * ONE JSON FILE PER CONVERSATION under <data>/conversations/, following store.js's data
 * directory and its AROMA_DATA_DIR override so every truth file lives together and is
 * gitignored by the same rule.
 *
 * It is READ + APPEND + DELETE, and only the UI path calls it. There is no update, no
 * rename, no partial write and no cross-conversation query, because nothing needs them —
 * a small closed surface is the whole security argument for a store that holds verbatim
 * conversation text.
 *
 * THIS IS NOT THE XIANGXIANG LAB ARCHIVE. The archive is a separate, append-only research
 * record living OUTSIDE the repo, under Owner decision A′, which deliberately DISCARDS the
 * assistant's words on any turn that used external read context. This file is the opposite
 * by necessity: it is what the Owner sees when he clicks a conversation, so it stores what
 * was actually on screen. The two must not be confused and neither reads the other.
 *
 * ── THE ID IS THE ATTACK SURFACE ─────────────────────────────────────────────
 * The conversation id is minted by the browser and arrives over HTTP, and it is used to
 * build a FILE PATH. So it is validated against a closed character class before it is
 * allowed near the filesystem — not sanitised, not escaped, REFUSED. `path.join` with
 * '../aroma-truth' would cheerfully walk out of the directory and overwrite the truth
 * store; nothing here gives it the chance.
 *
 * ── AND IT MAY NOT NARRATE WHAT IT HOLDS ─────────────────────────────────────
 * Every other log in this project carries counts and short enums only. This module holds
 * the Owner's conversations, so it logs NOTHING at all — not a title, not a preview, not a
 * length. An id and a count are all any caller may record about it.
 */

const fs = require('node:fs')
const path = require('node:path')

/** Same data directory as store.js, same override, so the truth files live together. */
const DATA_DIR = process.env.AROMA_DATA_DIR || path.resolve(__dirname, '../../data')
const CONVERSATION_DIR_NAME = 'conversations'

/** The title is the first user message, trimmed. No model call: a title is not worth one. */
const TITLE_MAX = 30

/**
 * THE ONLY ID SHAPE THAT MAY BECOME A FILENAME.
 *
 * The page mints `crypto.randomUUID()`, with a dated fallback for older engines, so this
 * accepts lowercase hex, digits and hyphens and nothing else — no dot, no slash, no
 * backslash, no colon, no drive letter. '..' cannot be spelled without a dot, so traversal
 * is not merely blocked, it is unrepresentable.
 */
const ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/

function isValidId (id) {
  return typeof id === 'string' && ID_RE.test(id)
}

function titleFrom (text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (!t) return '新對話'
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) + '…' : t
}

/**
 * @param {{ dataDir?: string }} options — dataDir is injected by tests so no test ever
 *   writes into the real data directory.
 */
function createConversationStore (options = {}) {
  const baseDir = options.dataDir || DATA_DIR
  const dir = path.join(baseDir, CONVERSATION_DIR_NAME)

  const fileFor = (id) => path.join(dir, id + '.json')

  function readOne (id) {
    try {
      const raw = fs.readFileSync(fileFor(id), 'utf8')
      const c = JSON.parse(raw)
      if (!c || typeof c !== 'object' || Array.isArray(c)) return null
      if (!Array.isArray(c.messages)) return null
      return c
    } catch (_) {
      // Missing OR corrupt. One unreadable file must never take the others down with it,
      // and must never be reported as an empty conversation either — null is "not there".
      return null
    }
  }

  /** The full transcript, or null. */
  function get (id) {
    if (!isValidId(id)) return null
    return readOne(id)
  }

  /**
   * METADATA ONLY, newest-first by updatedAt. The sidebar needs titles and times; handing
   * it every transcript in the account would put the whole history on the wire to draw a
   * list of names.
   */
  function list () {
    let names
    try { names = fs.readdirSync(dir) } catch (_) { return [] } // not created yet is not an error
    const out = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      if (!isValidId(id)) continue // a stray file is not a conversation
      const c = readOne(id)
      if (!c) continue
      out.push({
        id: c.id,
        title: c.title || '新對話',
        createdAt: c.createdAt || null,
        updatedAt: c.updatedAt || c.createdAt || null,
        messageCount: c.messages.length
      })
    }
    out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    return out
  }

  /**
   * ONE COMPLETED TURN — the question and the answer, appended together.
   *
   * Called once per completed turn from the UI path and nowhere else. A turn is only
   * written after the reply exists, so a failed turn leaves no half-conversation behind.
   */
  function appendTurn ({ id, userText, replyText, servedBy = null, now = null } = {}) {
    if (!isValidId(id)) throw new Error('invalid_conversation_id')
    const ts = now || new Date().toISOString()

    const existing = readOne(id)
    const conversation = existing || {
      id,
      title: titleFrom(userText),
      createdAt: ts,
      updatedAt: ts,
      messages: []
    }

    // The title is set once, from the first question. A later turn does not rename a
    // conversation the Owner has already learned to recognise in the list.
    if (!conversation.title) conversation.title = titleFrom(userText)

    conversation.messages.push({ role: 'user', content: String(userText == null ? '' : userText), servedBy: null, ts })
    conversation.messages.push({ role: 'assistant', content: String(replyText == null ? '' : replyText), servedBy: servedBy || null, ts })
    conversation.updatedAt = ts

    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(fileFor(id), JSON.stringify(conversation, null, 2))
    return { id, messageCount: conversation.messages.length }
  }

  /** @returns {boolean} whether a conversation was actually removed. */
  function remove (id) {
    if (!isValidId(id)) return false
    try {
      fs.unlinkSync(fileFor(id))
      return true
    } catch (_) {
      return false // already gone is not an error
    }
  }

  return { list, get, appendTurn, remove, dir }
}

/**
 * The process-wide REAL instance. app.js injects it into the demo router explicitly; it is
 * deliberately NOT a default anywhere, because a default writer is how a test suite wrote
 * four fixture conversations into the Owner's data directory.
 */
const conversationStore = createConversationStore()

/**
 * THE INERT STORE — what a caller gets when it did not ask for persistence.
 *
 * READS answer truthfully for a store that holds nothing: an empty list, nothing found,
 * nothing removed. It is not broken, it is empty, and the routes surface that honestly
 * (a 404 rather than an error page).
 *
 * THE WRITE THROWS, and that is the correction this file needed. It used to return
 * `{ id: null, messageCount: 0 }` — a SUCCESS SHAPE. Had the production wiring in app.js
 * ever regressed to the default, conversations would have stopped being saved and nothing
 * anywhere would have said so: the exact silent degradation this inversion was introduced
 * to prevent, reintroduced by the fix for it.
 *
 * `INERT_SAVE` in settingsRouter got this right in the same commit. Two inert
 * implementations in one codebase must not disagree about whether silence is acceptable,
 * and inertStoresAreLoud.test.js now enforces that across every INERT_* export rather than
 * trusting either of them to stay correct on its own.
 */
const INERT_CONVERSATION_STORE = Object.freeze({
  list: () => [],
  get: () => null,
  appendTurn: () => { throw new Error('conversation_store_not_wired') },
  remove: () => false,
  dir: null,
  inert: true
})

module.exports = {
  createConversationStore,
  conversationStore,
  INERT_CONVERSATION_STORE,
  isValidId,
  titleFrom,
  CONVERSATION_DIR_NAME,
  TITLE_MAX
}
