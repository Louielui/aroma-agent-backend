'use strict'

/**
 * shapeDrift.js — has the field knowledge B plans against stopped being true?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS: THE DANGEROUS DIRECTION IS SILENT (HR-71).
 *
 * `capturedShapes.js` is not a fixture. It is required at module load and reaches production
 * twice — `catalogueForPrompt()` tells the model what exists, `fieldTier()`/`coverageOf()` tell
 * the server what to believe. A dated snapshot decides both, and the two ways it can rot are
 * not equally harmful:
 *
 *   a field APPEARS that the capture never saw   → B refuses. Annoying, honest, VISIBLE.
 *   a field the capture saw FULL has EMPTIED     → B proceeds. ⛔ A WRONG ANSWER HE BELIEVES.
 *
 * A field NAME changing is rare and loud. A field quietly emptying is common and silent, and
 * `latest_price 5/55 → SPARSE` is exactly the protection that degrades without anything
 * going red.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ TWO OUTPUTS WITH DIFFERENT AUTHORITY. THIS IS THE WHOLE DESIGN. ───────
 *
 * > **Owner: 「A threshold I cannot derive is a number that feels safe, and this project has
 * > paid for two of those already. A line I read myself carries no false alarm and no
 * > manufactured confidence.」**
 *
 *   ALARM   field-SET changes — a name appeared, a name vanished, a type changed.
 *           Binary. No threshold exists to be chosen, so this can fire on its own.
 *
 *   REPORT  coverage changes — a rate moved. **This NEVER fires.** Any trigger would need a
 *           threshold nobody can derive, so it renders as a line the Owner reads and judges.
 *
 * ── ⛔ RATES, NOT RAW PAIRS, BECAUSE THE DENOMINATOR IS THE BUSINESS ─────────
 *
 * `orderPlanning` went 55 rows → 37 between two captures: live data moving, not drift. So
 * `32/55` cannot be diffed against `20/37` as a pair — every ratio would change on every
 * capture and the check would be noise by its second run, which is how a check gets ignored.
 * The comparable quantity is nonEmpty/present. 58% → 57% is nothing; 58% → 35% is real.
 *
 * ── ⛔ AND SMALL DENOMINATORS ARE NOT A MEASUREMENT ──────────────────────────
 *
 * > **Owner: 「3/36 to 2/30 must read as noise ON ITS FACE, or I will treat it as a trend the
 * > first time I am tired.」**
 *
 * So `noise: true` is carried on the row itself, not appended as a footnote a reader can be
 * too tired to reach. 8% → 7% on three rows is arithmetic, not evidence.
 *
 * ── TIER IS A LOSSY PROJECTION OF THE RATIO (beside the CANDIDATE finding) ───
 *
 * A tier-only diff would miss a field halving: 32/55 and 20/55 are both PRESENT. That is the
 * SAME defect as `CANDIDATE` once hiding three states — both times the projection discarded
 * exactly what was later needed, and both times it looked like simplification. So this compares
 * the ratio and reports the tier, never the reverse.
 */

/** A numerator this small is arithmetic, not evidence. Stated, not hidden in a threshold. */
const NOISE_FLOOR = 5

/** @returns {number|null} nonEmpty/present, or null when there is nothing to divide. */
function rateOf (f) {
  if (!f || typeof f.present !== 'number' || f.present <= 0) return null
  return f.nonEmpty / f.present
}

function byName (fields) {
  const m = new Map()
  for (const f of (fields || [])) m.set(f.name, f)
  return m
}

/**
 * Compare one endpoint's captured shape against a freshly read one.
 *
 * ⛔ AN ENDPOINT THAT RETURNED NO ROWS YIELDS NO COVERAGE CLAIMS, IN EITHER DIRECTION.
 * 「no rows were returned, so no fields were observed」 is a fact; inferring that its fields
 * vanished would be the claim this codebase refuses to make.
 */
function driftForEndpoint (name, captured, live) {
  const alarms = []
  const coverage = []
  const capFields = byName(captured && captured.fields)
  const liveFields = byName(live && live.fields)

  const capEmpty = !captured || captured.rowsSeen === 0
  const liveEmpty = !live || live.rowsSeen === 0

  // Rows going to zero (or arriving from zero) is a fact about the endpoint, not about fields.
  if (capEmpty !== liveEmpty) {
    alarms.push({
      endpoint: name,
      kind: liveEmpty ? 'ROWS_GONE' : 'ROWS_ARRIVED',
      detail: { was: captured ? captured.rowsSeen : null, now: live ? live.rowsSeen : null }
    })
  }
  if (capEmpty || liveEmpty) return { alarms, coverage }

  for (const [fname, capF] of capFields) {
    const liveF = liveFields.get(fname)
    if (!liveF) { alarms.push({ endpoint: name, kind: 'FIELD_GONE', field: fname }); continue }

    const capTypes = (capF.types || []).join('|')
    const liveTypes = (liveF.types || []).join('|')
    if (capTypes !== liveTypes) {
      alarms.push({ endpoint: name, kind: 'TYPE_CHANGED', field: fname, detail: { was: capTypes, now: liveTypes } })
    }

    const was = rateOf(capF)
    const now = rateOf(liveF)
    if (was === null || now === null) continue
    // ⛔ REPORTED WHETHER IT MOVED OR NOT IS WRONG TOO — an unchanged rate is not news. But the
    // decision of what counts as movement stays with the reader, so the only filter here is
    // exact equality, which cannot be a judgement.
    if (was === now) continue
    coverage.push({
      endpoint: name,
      field: fname,
      was: { nonEmpty: capF.nonEmpty, present: capF.present, rate: was },
      now: { nonEmpty: liveF.nonEmpty, present: liveF.present, rate: now },
      direction: now < was ? 'down' : 'up',
      // ⛔ ON THE ROW, NOT IN A FOOTNOTE. Either numerator being tiny makes the pair arithmetic.
      noise: capF.nonEmpty < NOISE_FLOOR || liveF.nonEmpty < NOISE_FLOOR
    })
  }

  for (const fname of liveFields.keys()) {
    if (!capFields.has(fname)) alarms.push({ endpoint: name, kind: 'FIELD_NEW', field: fname })
  }

  return { alarms, coverage }
}

/**
 * @param {object} captured  the CAPTURED table from capturedShapes.js
 * @param {object} live      the same shape, freshly read
 * @returns {{alarms:Array, coverage:Array, endpointsCompared:number, alarmed:boolean}}
 */
function shapeDrift (captured, live) {
  const alarms = []
  const coverage = []
  let endpointsCompared = 0

  for (const name of Object.keys(captured || {})) {
    const l = live && live[name]
    if (!l) {
      // ⛔ NOT SILENCE. An endpoint the fresh read could not produce is an alarm, because the
      // alternative is a drift report that quietly covers five of six and reads as complete.
      alarms.push({ endpoint: name, kind: 'NOT_READ' })
      continue
    }
    endpointsCompared++
    const d = driftForEndpoint(name, captured[name], l)
    alarms.push(...d.alarms)
    coverage.push(...d.coverage)
  }

  // Largest fall first: the direction that produces a believed wrong answer leads the line.
  coverage.sort((a, b) => (a.now.rate - a.was.rate) - (b.now.rate - b.was.rate))

  return { alarms, coverage, endpointsCompared, alarmed: alarms.length > 0 }
}

module.exports = { shapeDrift, driftForEndpoint, rateOf, NOISE_FLOOR }
