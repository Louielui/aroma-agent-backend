'use strict'

/**
 * claimBinding.js — A2 Phase 2. Bind a direct-answer claim to the evidence it is about,
 * STRUCTURALLY, and verify that binding server-side.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * NOTHING HERE ENFORCES ANYTHING. It classifies and verifies. No reply is changed, no
 * sentence is dropped, `checkEvidence` is not called, and no mode flag exists yet.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── THE TWO BLOCKERS THIS REMOVES ────────────────────────────────────────────
 *
 * **BLOCKER 1 — a sentence has no source.** `validatePlan` splits `directAnswer` into
 * sentences, and a sentence carries no structural mapping to the evidence it is about.
 * Handing `checkEvidence` the whole `evidenceSets` array would let an UNRELATED source's
 * unknown coverage refuse a sentence about a different one:
 *
 *     sentence is about invoices → invoice evidence covers it →
 *     an unrelated Gmail read has unknown coverage → the invoice sentence is refused.
 *
 * **BLOCKER 2 — truncation is set-wide and a row is not.** `PO123.status = received` is
 * fully supported even when 100 of 500 purchase orders were returned, because PO123 is one
 * of the 100 that came back. Set-wide incompleteness says nothing about a row that was
 * actually retrieved. The existing fact validator already binds
 * `sourceId → retrieved row → field/value`, and that binding stays valid on its own terms.
 *
 * ── THE ARCHITECTURE RULE ────────────────────────────────────────────────────
 *
 * > **Owner: 「The MODEL may declare the claim structure. The SERVER must VERIFY that
 * > declaration structurally. Never trust a model declaration merely because it is in JSON.」**
 *
 * So every field a model sends is checked against what was actually read:
 *   · every `sourceId` must exist among the retrieved rows
 *   · every `evidenceSource` must be a source that was read LIVE this turn
 *   · a declared scope may not contradict the evidence's own `queryScope`
 *   · anything unverifiable FAILS CLOSED to UNVERIFIED — never to a kind
 *
 * ⛔ NO PROSE IS READ. `text` is carried so a later phase can attribute a verdict to a
 * sentence; it is never inspected. There is no noun list here, no regex over claim text, and
 * no scope inferred from words — the three things this project has removed three times
 * (HR-56). A test asserts the verdict is unchanged when the text is replaced wholesale.
 */

/** What a claim is ABOUT, structurally. Declared by the model, verified here. */
const CLAIM_KIND = Object.freeze({
  /** One or more specific retrieved rows. Its truth does not depend on source coverage. */
  ROW_LOCAL: 'row_local',
  /** A universal/aggregate claim over a DECLARED subset of a source. */
  SET_SCOPED: 'set_scoped',
  /** A claim about the entire wider source. Needs source-wide coverage. */
  SOURCE_WIDE: 'source_wide'
})

const KNOWN_KINDS = new Set(Object.values(CLAIM_KIND))

/**
 * The verdict on a declaration. Two values only, on purpose: this phase establishes whether
 * a binding HOLDS, not what to do about it. A third value meaning 「refuse」 belongs to the
 * enforcement phase and is deliberately absent so nothing can start acting on one early.
 */
const BINDING = Object.freeze({
  VERIFIED: 'verified',
  UNVERIFIED: 'unverified'
})

/**
 * ⛔ EVIDENCE IS IDENTIFIED BY readKey, NOT BY source.
 *
 * This was `Map(source -> EvidenceSet)`, which is a Map, which means last write wins. One
 * source can now be read by TWO operations in a turn — aroma_system.replenishment and
 * aroma_system.purchasing — and a set_scoped claim naming 「aroma_system」 was silently checked
 * against whichever read happened to be stored last. That is a coverage rule applied to the
 * wrong subset, which is indistinguishable from having no rule.
 *
 * `byKey` is the exact identity. `bySource` collects CANDIDATES for the legacy bare-source
 * form, which resolves only when exactly one live read owns that source.
 */
function liveEvidence (evidenceSets) {
  const byKey = new Map()
  const bySource = new Map()
  for (const e of (Array.isArray(evidenceSets) ? evidenceSets : [])) {
    if (!e || !e.source || e.trust !== 'live') continue
    const key = e.readKey || e.source
    byKey.set(key, e)
    const set = bySource.get(e.source) || new Set()
    set.add(key)
    bySource.set(e.source, set)
  }
  return { byKey, bySource }
}

/**
 * Every retrieved row, by CANONICAL ref, plus the legacy aliases that point at it.
 * Same discipline as the Answer Plan's evidence index, for the same reason: a bare id shared
 * by two reads names two different entities, and choosing one of them is a guess.
 */
function retrievedRows (itemsBySource) {
  const byRef = new Map() // canonical `readKey#sourceId` -> readKey
  const aliasOwners = new Map() // legacy alias -> Set(canonical refs)
  for (const group of (Array.isArray(itemsBySource) ? itemsBySource : [])) {
    if (!group || !group.source || !Array.isArray(group.items)) continue
    for (const it of group.items) {
      if (!it || it.sourceId == null) continue
      const readKey = it.readKey || group.readKey || group.source
      const canonical = `${readKey}#${it.sourceId}`
      byRef.set(canonical, readKey)
      for (const a of [String(it.sourceId), `${group.source}#${it.sourceId}`]) {
        if (a === canonical) continue
        const set = aliasOwners.get(a) || new Set()
        set.add(canonical)
        aliasOwners.set(a, set)
      }
    }
  }
  return { byRef, aliasOwners }
}

/** A declared row reference → its canonical form, or null when it names no single row. */
function resolveDeclaredRef (rows, ref) {
  const key = String(ref)
  if (rows.byRef.has(key)) return key
  const owners = rows.aliasOwners.get(key)
  if (!owners || owners.size !== 1) return null
  return [...owners][0]
}

/**
 * A declared scope may not exceed or contradict the scope the evidence actually has.
 * Compared FIELD-TO-FIELD against `evidence.queryScope` — never parsed from a sentence.
 * Equality only: 「the same field over the same window」. Anything else is a mismatch,
 * because deciding that one window CONTAINS another is arithmetic this phase does not do.
 */
function scopeAgrees (claimScope, evidenceScope) {
  const c = claimScope && typeof claimScope === 'object' ? claimScope : {}
  const e = evidenceScope && typeof evidenceScope === 'object' ? evidenceScope : {}
  return c.field === e.field && c.window === e.window
}

/** Coverage of the WIDER source — the A1 test, unchanged and reused rather than restated. */
function sourceCovered (e) {
  return e.completeWithinScope === true &&
    Number.isFinite(e.matchingTotal) &&
    Number.isFinite(e.sourceTotal) &&
    e.matchingTotal === e.sourceTotal
}

/**
 * Verify one declared claim against what was really read.
 * @returns {{ claimKind: string|null, binding: string, reason: string|null, evidenceSources: string[], sourceIds: string[] }}
 */
function verifyOne (claim, live, rows) {
  const declared = claim && typeof claim === 'object' ? claim : {}
  const sources = Array.isArray(declared.evidenceSources) ? declared.evidenceSources.map(String) : []
  const sourceIds = Array.isArray(declared.sourceIds) ? declared.sourceIds.map(String) : []
  const kind = KNOWN_KINDS.has(declared.claimKind) ? declared.claimKind : null

  const base = { claimKind: kind, evidenceSources: sources, sourceIds }
  const no = (reason) => Object.assign({}, base, { binding: BINDING.UNVERIFIED, reason })

  // ⛔ An unrecognised kind is NOT coerced to anything. `claimKind` stays null.
  if (kind === null) return no('unknown_claim_kind')
  if (sources.length === 0) return no('no_evidence_source')

  // ── EACH DECLARED SOURCE MUST NAME EXACTLY ONE LIVE READ ────────────────────
  // An exact readKey resolves itself. A legacy bare SOURCE resolves only while it owns a
  // single live read; once one source has been read twice in a turn it names two different
  // subsets, and picking either would apply a coverage rule to the wrong one.
  const resolved = []
  for (const s of sources) {
    if (live.byKey.has(s)) { resolved.push(s); continue }
    const candidates = live.bySource.get(s)
    if (!candidates || candidates.size === 0) return no('source_not_read')
    if (candidates.size > 1) return no('evidence_source_ambiguous')
    resolved.push([...candidates][0])
  }
  const declaredKeys = new Set(resolved)

  if (kind === CLAIM_KIND.ROW_LOCAL) {
    // A row-local claim with no rows is not row-local. Fail closed rather than treat it as
    // a weaker kind — silently reclassifying a declaration is exactly what 「never trust a
    // model declaration」 forbids.
    if (sourceIds.length === 0) return no('row_local_without_rows')
    // ⛔ THE CROSS-PRODUCT RULE IS GONE, and its replacement is stricter, not looser. It used
    // to require every id under EVERY declared source, which was the only thing a bare id
    // could be checked against. A canonical ref carries its own read, so the structural
    // question is exact: does this row exist, and does it belong to a read this claim
    // declared? An ambiguous alias resolves to no row and fails here.
    for (const id of sourceIds) {
      const canonical = resolveDeclaredRef(rows, id)
      if (!canonical) return no('source_id_not_retrieved')
      if (!declaredKeys.has(rows.byRef.get(canonical))) return no('row_outside_declared_evidence')
    }
    // ⛔ BLOCKER 2. Truncation is deliberately NOT consulted here. The row came back; a cap
    // on how many OTHER rows came back has no bearing on it.
    return Object.assign({}, base, { binding: BINDING.VERIFIED, reason: null })
  }

  if (kind === CLAIM_KIND.SET_SCOPED) {
    const scope = declared.scope && typeof declared.scope === 'object' ? declared.scope : {}
    if (scope.field == null && scope.window == null) return no('scope_not_declared')
    for (const key of resolved) {
      const e = live.byKey.get(key)
      if (!scopeAgrees(scope, e.queryScope)) return no('scope_mismatch')
      // Within the declared scope the read must actually be complete, or the aggregate is
      // over an unknown fraction of its own subset.
      if (e.completeWithinScope !== true) return no('scope_not_complete')
    }
    return Object.assign({}, base, { binding: BINDING.VERIFIED, reason: null })
  }

  // SOURCE_WIDE — the A1 coverage test. Today `sourceTotal` is null on every endpoint, so
  // this refuses every source-wide declaration. That is the honest state, not a bug.
  for (const key of resolved) {
    if (!sourceCovered(live.byKey.get(key))) return no('source_coverage_unknown')
  }
  return Object.assign({}, base, { binding: BINDING.VERIFIED, reason: null })
}

/**
 * Verify every declared claim. Pure, synchronous, no I/O, no model call.
 *
 * ⛔ AN ABSENT DECLARATION YIELDS AN EMPTY ARRAY — never an inferred binding. A provider that
 * does not send the new structure produces no bindings at all, and the caller records that
 * state as UNBOUND. Inferring one from prose is the thing this module exists to avoid.
 *
 * @param {object[]|null|undefined} claims
 * @param {{evidenceSets?: object[], itemsBySource?: object[]}} ctx
 */
function verifyClaimBindings (claims, ctx = {}) {
  if (!Array.isArray(claims) || claims.length === 0) return []
  const live = liveEvidence(ctx.evidenceSets)
  const rows = retrievedRows(ctx.itemsBySource)
  return claims.map((c) => verifyOne(c, live, rows))
}

module.exports = { verifyClaimBindings, CLAIM_KIND, BINDING, scopeAgrees, sourceCovered }
