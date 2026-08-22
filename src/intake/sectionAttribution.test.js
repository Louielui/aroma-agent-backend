'use strict'

/**
 * sectionAttribution.test.js — X4.2.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ PRODUCTION 866e77d9. Calendar returned 2 rows, Drive returned 4, and all six were printed
 * under one model-authored heading — 「日曆：讀到，但沒有一項落在下星期」. Four Drive documents were
 * shown to the Owner as his calendar, and the two real appointments were lost among them.
 *
 * ⛔ NOTHING WAS MIXED. Every row kept its correct server-resolved `readKey` the whole way — the
 * data was right, and the label on top of it was the model's. Nothing compared the two.
 *
 * ⛔ AND THE CHECK THAT LOOKED LIKE IT SHOULD HAVE CAUGHT IT NEVER RAN. `proseIsGrounded`
 * iterates LATIN tokens; the heading is entirely CJK, so its loop executed zero times and it
 * returned true. The heading was not judged acceptable — it was never examined.
 *
 * These tests are pure: no model, no connector, no data root.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/sectionAttribution.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const sa = require('./sectionAttribution')
const { judgeSectionHeading, sourceClaimOf, sourceOfReadKey, itemSourceLabel, itemSources, VERDICT } = sa
const { LABELS } = require('./readStateGuard')
const { labelForOperation } = require('../context/readOperations')

/** The renderer's own resolver, reproduced exactly — no second label table exists. */
const labelFor = (operation, readKey, source) =>
  labelForOperation(operation) || labelForOperation(readKey) || LABELS[source] || source || readKey || ''

/**
 * ⛔ COMMENTS ARE NOT CODE — five tranches running, a source fence has failed because the
 * paragraph EXPLAINING why a symbol is forbidden contains that symbol. Strip first, scan after.
 */
const codeOf = () => require('fs').readFileSync(require.resolve('./sectionAttribution'), 'utf8')
  .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '').replace(new RegExp('^[ \\t]*//.*$', 'gm'), '')

const I = (readKey, title) => ({ readKey, title, facts: [] })
const CAL = [I('calendar', 'Wedding Catering'), I('calendar', '插 Seagate 做每月備份')]
const DRV = [
  I('drive', 'Aroma_LivingDocs_Framework_v1'),
  I('drive', 'allowed-files-governance-contract-v1.md'),
  I('drive', 'unified-context-tool-gateway-readonly-design-brief-v1.md'),
  I('drive', 'Gluten-Free Birthday Dinner Menu.pdf')
]

/**
 * ⛔ THE REAL RENDERER, NOT A RESTATEMENT OF IT.
 *
 * The first version of this file reproduced readResultView's section loop here so it could be
 * asserted cheaply. The suite went green and THREE renderer mutations survived it — trusting
 * the model heading, deriving a source from the title, and suppressing item attribution
 * altogether — because nothing in the file ever executed the renderer. A test that reimplements
 * the thing it is testing proves only that the copy agrees with itself.
 */
const { renderPlanSection } = require('./readResultView')
const renderSection = (heading, items) => ({
  text: renderPlanSection({ heading, items }),
  judged: judgeSectionHeading({ heading, items })
})

/* ═══ 1. THE CONTRACT ══════════════════════════════════════════════════════ */

describe('source resolution comes only from the server', () => {
  test('readKey → source, from the canonical tables', () => {
    assert.equal(sourceOfReadKey('calendar'), 'calendar')
    assert.equal(sourceOfReadKey('drive'), 'drive')
    assert.equal(sourceOfReadKey('gmail'), 'gmail')
    assert.equal(sourceOfReadKey('github'), 'github')
    assert.equal(sourceOfReadKey('public_knowledge.search'), 'public_knowledge')
  })

  test('*** ⛔ aroma_system IS MANY-TO-ONE, AND THE OPERATION SURVIVES (Blocker-8) ***', () => {
    assert.equal(sourceOfReadKey('aroma_system.invoices'), 'aroma_system')
    assert.equal(sourceOfReadKey('aroma_system.inventory'), 'aroma_system')
    // Same source, DIFFERENT Owner-facing names — the operation is not collapsed.
    assert.equal(itemSourceLabel('aroma_system.invoices', labelFor), '發票')
    assert.equal(itemSourceLabel('aroma_system.inventory', labelFor), '倉存')
  })

  test('*** ⛔ AN UNKNOWN KEY RESOLVES TO NOTHING — never a guess ***', () => {
    for (const k of ['nonsense', '', null, undefined, 'calendar.write', 'drive.something']) {
      assert.equal(sourceOfReadKey(k), null, '⛔ invented a source for ' + JSON.stringify(k))
    }
    assert.equal(itemSourceLabel('nonsense', labelFor), null)
  })

  test('*** ⛔ NO SOURCE IS EVER DERIVED FROM TITLE OR FILENAME ***', () => {
    const code = codeOf()
    for (const banned of ['title', 'filename', 'canonical', '.pdf', '.md', 'extension', 'sourceId']) {
      assert.equal(code.includes(banned), false, '⛔ the module reached for: ' + banned)
    }
  })

  test('the label table is reused, not duplicated', () => {
    const code = codeOf()
    assert.match(code, /require\('\.\/readStateGuard'\)/)
    assert.match(code, /require\('\.\.\/context\/readOperations'\)/)
    assert.equal(itemSourceLabel('calendar', labelFor), LABELS.calendar)
    assert.equal(itemSourceLabel('drive', labelFor), LABELS.drive)
  })
})

describe('source-claim detection is a closed list, not a language engine', () => {
  test('*** ⛔ CJK SOURCE LABELS ARE RECOGNISED — the blind spot that shipped the defect ***', () => {
    assert.equal(sourceClaimOf('日曆'), 'calendar')
    assert.equal(sourceClaimOf('日曆：讀到，但沒有一項落在下星期'), 'calendar')
    assert.equal(sourceClaimOf('餐廳系統'), 'aroma_system')
  })

  test('the same protection in English', () => {
    assert.equal(sourceClaimOf('Calendar'), 'calendar')
    assert.equal(sourceClaimOf('Calendar: read, nothing next week'), 'calendar')
    assert.equal(sourceClaimOf('Drive'), 'drive')
    assert.equal(sourceClaimOf('Gmail — this week'), 'gmail')
  })

  test('*** ⛔ A SEMANTIC HEADING MAKES NO CLAIM AND IS NOT TOUCHED ***', () => {
    for (const h of ['相關資料', '主要風險', '下星期要留意嘅嘢', 'What matters next week', '']) {
      assert.equal(sourceClaimOf(h), null, '⛔ treated as a source claim: ' + JSON.stringify(h))
    }
  })

  test('*** ⛔ A SOURCE NAMED MID-SENTENCE IS NOT A CLAIM — it is a subject ***', () => {
    // Deleting this heading would destroy a perfectly good semantic one.
    assert.equal(sourceClaimOf('下星期同 Drive 上份合約有關嘅風險'), null)
    assert.equal(sourceClaimOf('風險：Drive 上有份合約未簽'), null)
  })

  test('an aroma_system OPERATION name claims its source', () => {
    assert.equal(sourceClaimOf('發票'), 'aroma_system')
    assert.equal(sourceClaimOf('倉存'), 'aroma_system')
  })
})

/* ═══ 2. FIXTURES A–L ══════════════════════════════════════════════════════ */

describe('Owner-visible behaviour', () => {
  test('*** ⛔ A — single-source Calendar section keeps its 日曆 heading ***', () => {
    const r = renderSection('日曆', CAL)
    assert.equal(r.judged.verdict, VERDICT.ALLOW)
    assert.match(r.text, /^### 日曆/)
    assert.equal(r.text.includes('［日曆］'), false, 'a single-read section needs no per-item label')
  })

  test('*** ⛔ B — 日曆 over calendar + drive CANNOT RENDER ***', () => {
    const r = renderSection('日曆', CAL.concat(DRV))
    assert.equal(r.judged.verdict, VERDICT.REJECT_SOURCE_CONFLICT)
    assert.equal(r.text.includes('### 日曆'), false, '⛔ the misleading heading reached the Owner')
  })

  test('*** ⛔ C — the same protection in English ***', () => {
    const r = renderSection('Calendar', CAL.concat(DRV))
    assert.equal(r.judged.verdict, VERDICT.REJECT_SOURCE_CONFLICT)
    assert.equal(r.text.includes('### Calendar'), false)
  })

  test('*** ⛔ D — a semantic heading over a mixed section SURVIVES ***', () => {
    const r = renderSection('主要風險', CAL.concat(DRV))
    assert.equal(r.judged.verdict, VERDICT.ALLOW)
    assert.match(r.text, /^### 主要風險/, '⛔ a valid semantic heading was destroyed')
    // and the rows are still attributed, because the section spans two reads
    assert.match(r.text, /［日曆］Wedding Catering/)
    assert.match(r.text, /［Drive］Aroma_LivingDocs_Framework_v1/)
  })

  test('*** ⛔ E — after a rejected claim, every row carries its real source ***', () => {
    const r = renderSection('日曆', CAL.concat(DRV))
    assert.match(r.text, /［日曆］Wedding Catering/)
    assert.match(r.text, /［日曆］插 Seagate 做每月備份/)
    for (const d of DRV) assert.ok(r.text.includes('［Drive］' + d.title), '⛔ unattributed: ' + d.title)
    assert.equal((r.text.match(/［日曆］/g) || []).length, 2)
    assert.equal((r.text.match(/［Drive］/g) || []).length, 4)
  })

  test('*** ⛔ F — a Drive row can never be labelled Calendar because of its title ***', () => {
    // A file whose name reads like an appointment.
    const r = renderSection('日曆', CAL.concat([I('drive', 'Wedding Reception 2026-08-22 Calendar Invite.pdf')]))
    assert.match(r.text, /［Drive］Wedding Reception 2026-08-22 Calendar Invite\.pdf/)
    assert.equal(r.text.includes('［日曆］Wedding Reception 2026-08-22'), false)
  })

  test('*** ⛔ G — a Calendar row can never be labelled Drive because of the model heading ***', () => {
    const r = renderSection('Drive', CAL.concat(DRV))
    assert.equal(r.judged.verdict, VERDICT.REJECT_SOURCE_CONFLICT)
    assert.match(r.text, /［日曆］Wedding Catering/, '⛔ the heading relabelled a calendar row')
  })

  test('*** ⛔ H — a row with no readKey fails soft: no invented source, and no claim survives ***', () => {
    const r = renderSection('日曆', CAL.concat([I(null, 'legacy row')]))
    assert.equal(r.judged.verdict, VERDICT.REJECT_UNPROVABLE, 'an unprovable claim is refused')
    assert.equal(r.text.includes('### 日曆'), false)
    assert.match(r.text, /\*\*legacy row\*\*/, 'the row still renders')
    assert.equal(/［[^］]*］legacy row/.test(r.text), false, '⛔ a source was invented for it')
  })

  test('*** ⛔ I — aroma_system: source heading correct, operation identity preserved ***', () => {
    const items = [I('aroma_system.invoices', 'INV-1'), I('aroma_system.inventory', '蕃茄')]
    const r = renderSection('餐廳系統', items)
    assert.equal(r.judged.verdict, VERDICT.ALLOW, 'both rows really are aroma_system')
    assert.match(r.text, /^### 餐廳系統/)
    // …and the two reads stay distinguishable underneath it.
    assert.match(r.text, /［發票］INV-1/)
    assert.match(r.text, /［倉存］蕃茄/)
  })

  test('I2 — a heading naming ONE aroma operation over TWO cannot claim them both', () => {
    // 發票 claims aroma_system, and both rows are aroma_system, so the SOURCE claim stands —
    // which is why the per-read labels below carry the distinction the heading cannot.
    const r = renderSection('發票', [I('aroma_system.invoices', 'INV-1'), I('aroma_system.inventory', '蕃茄')])
    assert.equal(r.judged.verdict, VERDICT.ALLOW)
    assert.match(r.text, /［倉存］蕃茄/, '⛔ an inventory row sat silently under an invoice heading')
  })

  test('*** ⛔ L — the production shape: 2 Calendar + 4 Drive under one 日曆 heading ***', () => {
    const r = renderSection('日曆：讀到，但沒有一項落在下星期', CAL.concat(DRV))
    assert.equal(r.judged.verdict, VERDICT.REJECT_SOURCE_CONFLICT)
    assert.equal(r.text.includes('### 日曆'), false, '⛔ the exact production defect reproduced')
    assert.equal((r.text.match(/［日曆］/g) || []).length, 2, 'the two appointments are visibly Calendar')
    assert.equal((r.text.match(/［Drive］/g) || []).length, 4, 'the four documents are visibly Drive')
  })
})

/* ═══ 3. FENCES ════════════════════════════════════════════════════════════ */

describe('X4.2 fences', () => {
  test('*** ⛔ THE MODEL\'S WORDS ARE NEVER REWRITTEN — only dropped or kept ***', () => {
    const r = renderSection('日曆', CAL.concat(DRV))
    assert.equal(/### /.test(r.text), false, 'no server-authored heading was substituted')
    const ok = renderSection('日曆', CAL)
    assert.match(ok.text, /^### 日曆$/m, 'an allowed heading is printed verbatim')
  })

  test('*** ⛔ NO NEW AUTHORITY, NO NEW READ, NO EVIDENCE ***', () => {
    const code = codeOf()
    for (const banned of ['process.env', 'READ_ACCESS', 'sourcesForPlan', 'connector', 'executeRead',
      'EvidenceSet', 'trust', 'retrievedAt', 'proposal', 'dispatch', 'workOrder']) {
      assert.equal(code.includes(banned), false, '⛔ reached for: ' + banned)
    }
  })

  test('*** ⛔ IT IS NOT A CHINESE GROUNDING ENGINE — the alias set is closed and small ***', () => {
    assert.ok(sa.SOURCE_ALIASES.size < 40, 'alias count: ' + sa.SOURCE_ALIASES.size)
    for (const v of sa.SOURCE_ALIASES.values()) {
      assert.ok(Object.prototype.hasOwnProperty.call(LABELS, v), '⛔ alias maps to an unknown source: ' + v)
    }
  })

  test('J — ranking protections are untouched by X4.2', () => {
    const ap = require('./answerPlan')
    assert.equal(typeof ap.validatePlan, 'function')
    const view = require('fs').readFileSync(require.resolve('./readResultView'), 'utf8')
    assert.match(view, /composeRankingHeading|rankingClaim|looksLikeRankingHeading|rankingProof/,
      'the ranking path still exists in the render chain')
  })

  test('K — a section with no items, or no heading, degrades safely', () => {
    // ⛔ NO ROWS MEANS NOTHING SUPPORTS THE CLAIM, so it does not stand. I expected 「no rows,
    // no conflict to find」 — the code was right and I was wrong. A heading asserting 「these
    // are your calendar items」 over nothing is precisely the claim that must not survive by
    // default. Upstream already declines to render a section with no kept items; belt and braces.
    assert.equal(renderSection('日曆', []).judged.verdict, VERDICT.REJECT_SOURCE_CONFLICT)
    assert.equal(renderSection('', CAL.concat(DRV)).judged.verdict, VERDICT.ALLOW)
    const blanked = renderSection('', CAL.concat(DRV))
    assert.equal(blanked.text.includes('###'), false, 'a blank heading prints no bare ###')
    assert.match(blanked.text, /［日曆］/, 'rows are still attributed when the section is mixed')
  })
})
