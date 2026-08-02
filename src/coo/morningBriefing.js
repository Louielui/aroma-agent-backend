'use strict'

/**
 * morningBriefing.js — Aroma Morning Briefing v0.1. PURE, READ-ONLY assembler.
 *
 * It takes the SAME production read path the chat lane uses (buildReadContext over the
 * live connector), plus the pending-proposal store and Decision Recall, and returns a
 * structured brief. It has no write surface of any kind: it never dispatches, never
 * persists third-party content, and holds no client it could mutate anything with.
 *
 * ── THE RULES THAT ARE ENFORCED HERE, NOT MERELY DOCUMENTED ────────────────
 *  1. A `fact` without provenance is REFUSED — it is dropped and counted, never emitted.
 *  2. An `inference` or `recommendation` that cites no fact id is REFUSED the same way.
 *  3. Top Priorities is never padded. Fewer than three real items means fewer than three.
 *  4. `live_zero` ("read OK, nothing matched") and `unavailable` ("could not read") are
 *     different outcomes and are never merged. This is the distinction the whole read
 *     layer was built around and it survives into the brief.
 *  5. Aroma System is ALWAYS reported, always as unavailable, because there is no
 *     read-only connection configured. Its absence must be visible, not implied.
 *  6. Nothing about sales, stock, production, cost, purchasing or attendance may be
 *     inferred from Gmail/Drive/GitHub. There is no code path that produces such an
 *     item; scope is decided by SOURCE (statementScope.js), never by the text.
 *
 * Times are rendered in America/Winnipeg for the Owner, and every rendered time keeps
 * its original ISO string beside it as the evidence.
 */

const crypto = require('node:crypto')
const { scopeForSource, sourceRecordText, ownerWorkItemText } = require('./statementScope')
const { projectCoverageError } = require('./coverageError')

const SCHEMA_VERSION = 1
const TIMEZONE = 'America/Winnipeg'
const KINDS = Object.freeze(['fact', 'inference', 'recommendation'])
const SECTIONS = Object.freeze([
  'today', 'recentActivity', 'risks', 'topPriorities', 'decisionsNeeded', 'dataCoverage'
])

/** The four external sources, plus the two internal ones and the known gap. */
const CONTEXT_SOURCES = Object.freeze(['drive', 'gmail', 'calendar', 'github'])

/** The second GitHub repo, read with the SAME read-only token. Never blocks the brief. */
const SECOND_REPO = Object.freeze({ owner: 'Louielui', repo: 'aroma-system', key: 'github:aroma-system' })

/**
 * Aroma System — the restaurant's own operating system. There is no connector for it.
 * This is a CONSTANT, not a probe: v0.1 must say so plainly every time, so the gap can
 * never be mistaken for "nothing happened today".
 */
const AROMA_SYSTEM_COVERAGE = Object.freeze({
  source: 'aroma-system',
  trust: 'unavailable',
  count: 0,
  error: 'read-only connection not configured',
  usedFallback: false,
  permanentGap: true
})

/**
 * QUESTIONS THE BRIEF IS ASKED BUT HAS NO SOURCE FOR.
 *
 * Data Coverage listed SOURCES, so a question with no source at all was invisible: the
 * brief answered "today's schedule" and silently dropped "and deadlines", because no
 * source was missing — there was simply never one to miss. Coverage now names the
 * QUESTION too, so the gap is on screen instead of implied by an absence.
 */
const UNSOURCED_QUESTIONS = Object.freeze([
  Object.freeze({ source: 'deadlines', trust: 'unavailable', count: 0, permanentGap: true, error: 'no source configured', usedFallback: false }),
  Object.freeze({ source: 'awaiting-reply', trust: 'unavailable', count: 0, permanentGap: true, error: 'no source configured — gmail is read for records, not for reply state', usedFallback: false })
])

/* ── time ─────────────────────────────────────────────────────────────────── */

function makeFormatter (opts) {
  return new Intl.DateTimeFormat('en-CA', Object.assign({ timeZone: TIMEZONE }, opts))
}

/** { iso, display } — the display is for the Owner, the ISO is the evidence. */
function stamp (iso) {
  if (!iso) return { iso: null, display: null }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { iso: String(iso), display: null }
  const f = makeFormatter({ year: 'numeric', month: 'short', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  return { iso: d.toISOString(), display: f.format(d) + ' (' + TIMEZONE + ')' }
}

/** The Owner's calendar day, in Winnipeg, as YYYY-MM-DD. */
function localDay (iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = makeFormatter({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t) => (p.find((x) => x.type === t) || {}).value
  return get('year') + '-' + get('month') + '-' + get('day')
}

/* ── items ────────────────────────────────────────────────────────────────── */

function provenanceOf (r) {
  if (!r || !r.source || !r.sourceId) return null
  return {
    source: String(r.source),
    sourceId: String(r.sourceId),
    originalDate: r.originalDate ? stamp(r.originalDate) : { iso: null, display: null },
    link: r.link || null,
    retrievedAt: stamp(r.retrievedAt),
    usedFallback: r.usedFallback === true
  }
}

/**
 * Build one item, or return null if it breaks a rule. Returning null rather than
 * throwing is deliberate: one malformed item must not cost the Owner the whole brief.
 */
function makeItem ({ id, kind, text, provenance = null, basedOnFactIds = [], scope = null }, rejected) {
  const note = (why) => { if (rejected) rejected.push({ id, kind, why }); return null }

  if (!KINDS.includes(kind)) return note('unknown kind')
  if (typeof text !== 'string' || text.trim() === '') return note('empty text')

  // RULE 1 — a fact is a claim about the world and must say where it came from.
  if (kind === 'fact' && !provenance) return note('fact without provenance')

  // RULE 2 — an inference or a recommendation must rest on facts that are in this brief.
  const cites = Array.isArray(basedOnFactIds) ? basedOnFactIds.filter((x) => typeof x === 'string' && x) : []
  if (kind !== 'fact' && cites.length === 0) return note(kind + ' without a cited fact')

  // SCOPE COMES FROM THE SOURCE, never from the text and never from the caller's opinion.
  // A derived item inherits the scope it was given (topPriorities are owner_work_item),
  // and a fact's scope is looked up from where it came from. An unknown source yields
  // null, which the delivery validator treats as "remove".
  const resolved = kind === 'fact' ? scopeForSource(provenance && provenance.source) : scope
  return { id, kind, text: text.trim(), provenance, basedOnFactIds: cites, scope: resolved }
}

/**
 * REPLACED BY SCOPE — deliberately deleted rather than left as a second opinion.
 *
 * This scanned every item's raw text for words like "stock", and it was wrong twice
 * over. It could not stop anything (it only set an audit field, and the text shipped
 * regardless), and as a semantic model it treated a QUOTED email subject as though the
 * brief itself were asserting it — so the only way it could have "worked" was by hiding
 * a real, citable record the Owner wanted to see.
 *
 * What an item may claim is now decided by its SOURCE, in statementScope.js. The
 * vocabulary scan survives only as a narrative-only backstop inside the delivery
 * validator, where it can actually remove something.
 */

/* ── section builders ─────────────────────────────────────────────────────── */

const titleOf = (r) => (r.title && String(r.title).trim()) || '(untitled)'

function buildToday (calendarItems, nowIso, mk) {
  const today = localDay(nowIso)
  const out = []
  for (const r of calendarItems) {
    // The fallback explicitly means "beyond the window asked about", so such an event is
    // NOT today's business and must not be presented as it.
    if (r.usedFallback === true) continue
    if (!r.originalDate || localDay(r.originalDate) !== today) continue
    const s = stamp(r.originalDate)
    const it = mk({ id: null, kind: 'fact', text: sourceRecordText(r.source, r.title, s.display || s.iso), provenance: provenanceOf(r) })
    if (it) out.push(it)
  }
  return out
}

function buildRecentActivity (items, nowIso, mk, windowHours) {
  const cutoff = new Date(nowIso).getTime() - windowHours * 3600 * 1000
  const out = []
  for (const r of items) {
    if (r.source === 'calendar') continue // calendar is Today's business, not an update
    const t = r.originalDate ? new Date(r.originalDate).getTime() : NaN
    if (!Number.isFinite(t) || t < cutoff) continue
    const s = stamp(r.originalDate)
    // "gmail contains a record: <title>" -- what the source HOLDS, never what is true of
    // the business. The title is quoted, which is also what keeps the narrative backstop
    // precise: it scans only the words this system wrote.
    const it = mk({ id: null, kind: 'fact', text: sourceRecordText(r.source, r.title, s.display || s.iso), provenance: provenanceOf(r) })
    if (it) out.push(it)
  }
  return out
}

/**
 * Risks are what the READ ITSELF says, not a reading of anyone's content. A source that
 * could not be read is a real, evidenced blocker; guessing at risk from email subjects
 * would be exactly the inference this brief is forbidden to make.
 */
function buildRisks (coverage, mk) {
  const out = []
  for (const c of coverage) {
    if (c.trust !== 'unavailable') continue
    // A PERMANENT GAP IS NOT TODAY'S NEWS. Aroma System has never been connected and
    // deadlines have never had a source. Reporting them as fresh blockers every morning
    // buries the one source that actually broke today — and because Risks feeds Top
    // Priorities, it would fill the Owner's three slots with the same three lines
    // forever. They stay fully visible in Data Coverage, where a standing gap belongs.
    if (c.permanentGap === true) continue
    const f = mk({
      id: null,
      kind: 'fact',
      // THE PROJECTED CODE, not the adapter's sentence. A Risks line is rendered in the
      // browser exactly like any other, so it is the same leak as Data Coverage was.
      text: c.source + ' could not be read: ' + (projectCoverageError(c.error).code || 'read_failed'),
      provenance: { source: 'coverage:' + c.source, sourceId: 'coverage:' + c.source, originalDate: { iso: null, display: null }, link: null, retrievedAt: stamp(c.retrievedAt || null), usedFallback: false }
    })
    if (f) out.push(f)
  }
  return out
}

function buildDecisionsNeeded (pending, mk) {
  const out = []
  for (const p of pending) {
    const s = stamp(p.createdAt || null)
    const it = mk({
      id: null,
      kind: 'fact',
      text: ownerWorkItemText(String(p.task || '(no task text)') + (p.targetProject ? ' [' + p.targetProject + ']' : ''), s.display),
      provenance: { source: 'proposals', sourceId: String(p.id), originalDate: s, link: null, retrievedAt: stamp(p.retrievedAt || null), usedFallback: false }
    })
    if (it) out.push(it)
  }
  return out
}

/**
 * Top Priorities. Derived ONLY from facts already in the brief, each citing them, and
 * NEVER padded: three is a ceiling, not a quota. An empty brief yields an empty list.
 */
function buildTopPriorities (sections, mk) {
  const pool = []
  for (const f of sections.decisionsNeeded) pool.push({ f, weight: 3, why: 'awaiting your decision' })
  for (const f of sections.today) pool.push({ f, weight: 2, why: 'scheduled today' })
  for (const f of sections.risks) pool.push({ f, weight: 1, why: 'a source could not be read' })

  pool.sort((a, b) => b.weight - a.weight)
  const out = []
  for (const { f, why } of pool.slice(0, 3)) {
    const it = mk({ id: null, kind: 'recommendation', text: f.text + ' — ' + why, provenance: null, basedOnFactIds: [f.id], scope: 'owner_work_item' })
    if (it) out.push(it)
  }
  return out
}

/* ── the brief ────────────────────────────────────────────────────────────── */

/**
 * @param {object} deps
 *   buildReadContextFn, connector, sources, listPendingProposals, buildDecisionRecall,
 *   clock, env, updateWindowHours
 */
async function buildMorningBriefing (deps = {}) {
  const startedAt = Date.now()
  const nowIso = (typeof deps.clock === 'function' ? deps.clock() : new Date().toISOString())
  const env = deps.env || process.env
  const windowHours = Number.isFinite(deps.updateWindowHours) ? deps.updateWindowHours : 24

  const rejected = []
  let seq = 0
  const mk = (spec) => makeItem(Object.assign({}, spec, { id: spec.id || ('itm_' + (++seq).toString().padStart(3, '0')) }), rejected)

  // ── 1. the external read, through the production path, unchanged ──────────
  let rc = { perSource: [], items: [], status: 'NO_SOURCES' }
  try {
    rc = await deps.buildReadContextFn({
      connector: deps.connector,
      message: '', // no keywords → each source's bounded recent-items plan
      sources: Array.isArray(deps.sources) ? deps.sources : CONTEXT_SOURCES,
      env,
      now: nowIso
    }) || rc
  } catch (err) {
    rc = { perSource: CONTEXT_SOURCES.map((s) => ({ source: s, trust: 'unavailable', count: 0, error: (err && err.message) || 'read failed', usedFallback: false })), items: [], status: 'PARTIAL' }
  }

  const coverage = (Array.isArray(rc.perSource) ? rc.perSource : []).map((p) => Object.assign({ retrievedAt: nowIso }, p))
  const readItems = Array.isArray(rc.items) ? rc.items : []

  // ── 2. the SECOND GitHub repo, same read-only token, degrading alone ──────
  // A separate coverage row, never merged into `github`: one repo readable and the other
  // not is two different facts, and collapsing them would hide the one that matters.
  let secondRepoItems = []
  const secondRepo = { source: SECOND_REPO.key, trust: 'unavailable', count: 0, error: 'not attempted', usedFallback: false, retrievedAt: nowIso }
  if (deps.connector && typeof deps.connector.read === 'function') {
    try {
      const r = await deps.connector.read('github', 'listPullRequests', { owner: SECOND_REPO.owner, repo: SECOND_REPO.repo, state: 'all', per_page: 4 })
      if (r && r.trust === 'unavailable') {
        secondRepo.error = r.error || 'unavailable'
      } else {
        const live = ((r && r.results) || []).filter((x) => x && x.trust === 'live')
        secondRepoItems = live.map((x) => Object.assign({}, x, { source: SECOND_REPO.key, usedFallback: false }))
        secondRepo.trust = 'live'
        secondRepo.count = live.length
        secondRepo.error = null
      }
    } catch (err) {
      secondRepo.error = (err && err.message) || 'read failed'
    }
  }
  coverage.push(secondRepo)

  // ── 3. internal sources ───────────────────────────────────────────────────
  let pending = []
  const proposalsCoverage = { source: 'proposals', trust: 'unavailable', count: 0, error: 'not attempted', usedFallback: false, retrievedAt: nowIso }
  try {
    const all = (typeof deps.listPendingProposals === 'function' ? await deps.listPendingProposals() : []) || []
    pending = all.filter((p) => p && p.status === 'pending')
    proposalsCoverage.trust = 'live'
    proposalsCoverage.count = pending.length
    proposalsCoverage.error = null
  } catch (err) {
    proposalsCoverage.error = (err && err.message) || 'read failed'
  }
  coverage.push(proposalsCoverage)

  // Decision Recall stays its OWN source. It is a different kind of record from a
  // proposal and the Owner asked that they never be presented as one.
  const recallCoverage = { source: 'decision-recall', trust: 'unavailable', count: 0, error: 'not attempted', usedFallback: false, retrievedAt: nowIso }
  try {
    const dr = (typeof deps.buildDecisionRecall === 'function' ? await deps.buildDecisionRecall() : null)
    recallCoverage.trust = 'live'
    recallCoverage.count = (dr && Number.isFinite(dr.count)) ? dr.count : 0
    recallCoverage.error = null
  } catch (err) {
    recallCoverage.error = (err && err.message) || 'read failed'
  }
  coverage.push(recallCoverage)

  // ── 4. the gap that must always be visible ────────────────────────────────
  coverage.push(Object.assign({ retrievedAt: nowIso }, AROMA_SYSTEM_COVERAGE))
  for (const q of UNSOURCED_QUESTIONS) coverage.push(Object.assign({ retrievedAt: nowIso }, q))

  // ── 5. sections ───────────────────────────────────────────────────────────
  const calendarItems = readItems.filter((r) => r.source === 'calendar')
  const updateSource = readItems.concat(secondRepoItems)

  const sections = {
    today: buildToday(calendarItems, nowIso, mk),
    recentActivity: buildRecentActivity(updateSource, nowIso, mk, windowHours),
    risks: buildRisks(coverage, mk),
    decisionsNeeded: buildDecisionsNeeded(pending, mk)
  }
  sections.topPriorities = buildTopPriorities(sections, mk)

  const brief = {
    briefId: 'brf_' + crypto.randomBytes(6).toString('hex'),
    schemaVersion: SCHEMA_VERSION,
    generatedAt: stamp(nowIso),
    timezone: TIMEZONE,
    sections: {
      today: sections.today,
      recentActivity: sections.recentActivity,
      risks: sections.risks,
      topPriorities: sections.topPriorities,
      decisionsNeeded: sections.decisionsNeeded,
      dataCoverage: coverage.map((c) => {
        // THE ADAPTER'S MESSAGE NEVER LEAVES THIS LINE. It is projected to a fixed code
        // plus a scrubbed, bounded detail; the raw string is discarded here and exists
        // nowhere downstream — not in the response, not in the audit, not in a log.
        const e = projectCoverageError(c.error)
        return {
          source: c.source,
          // The three states, kept apart: read and found / read and empty / not read.
          state: c.trust === 'unavailable' ? 'unavailable' : (c.count > 0 ? 'live' : 'live_zero'),
          count: c.count || 0,
          errorCode: e.code,
          errorDetail: e.detail,
          usedFallback: c.usedFallback === true,
          retrievedAt: stamp(c.retrievedAt)
        }
      })
    },
    // DRAFT-TIME BOOKKEEPING ONLY. validateBriefForDelivery strips this before the brief
    // leaves the process. `operationalClaimViolations` is gone entirely: it was a field
    // that recorded a danger and then shipped it, which is worse than not looking.
    rejectedItems: rejected
  }

  const itemCounts = {}
  for (const s of SECTIONS) itemCounts[s] = (brief.sections[s] || []).length

  return {
    brief,
    audit: {
      briefId: brief.briefId,
      generatedAt: nowIso,
      schemaVersion: SCHEMA_VERSION,
      sourceStatuses: brief.sections.dataCoverage.map((c) => ({ source: c.source, state: c.state, count: c.count })),
      itemCounts,
      rejectedCount: rejected.length,
      durationMs: Date.now() - startedAt
      // NO `outcome` HERE. The builder does not know what was delivered — only the
      // delivery validator does, and it is the one that sets it. A builder that named
      // the outcome is exactly how `operational_claim_blocked` came to describe
      // something that had not been blocked.
    }
  }
}

module.exports = {
  buildMorningBriefing,
  makeItem,
  stamp,
  localDay,
  SCHEMA_VERSION,
  TIMEZONE,
  SECTIONS,
  KINDS,
  CONTEXT_SOURCES,
  SECOND_REPO,
  AROMA_SYSTEM_COVERAGE,
  UNSOURCED_QUESTIONS
}
