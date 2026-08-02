'use strict'

/**
 * briefHardening.test.js — the final pre-deploy gaps, each proven at the BYTES.
 *
 * Every test here asks the question that matters rather than the one that is easy: not
 * "was the field renamed" but "can the Owner's browser, the log, or the audit file be made
 * to contain a URL, a path, an address or a token". The difference between those two
 * questions is the whole reason this round exists.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { projectCoverageError, CODES } = require('./coverageError')
const { validateBriefForDelivery, linkIsSafe, REASON, OUTCOME } = require('./briefDelivery')
const { createBriefStore, verifyAuditDir, PROVISION_FAILURE, OPERATOR_SID } = require('./briefStore')
const { createBriefingRouter } = require('../routes/briefingRouter')

const NOW = '2026-08-02T14:00:00.000Z'

/** One string containing every shape that must never survive. */
const LEAKY =
  'read failed: GET https://gmail.googleapis.com/v1/users/me/messages?q=supplier%20invoice ' +
  'for chef@aromabistro741.com from C:\\Aroma\\secrets\\google-refresh-token.json ' +
  'token ya29.A0ARrdaMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxYYY'

/**
 * NOT "https://" — a provenance link is a legitimate https URL and is the whole point of
 * a citation. What must never appear is anything that came out of an ADAPTER'S message:
 * its endpoint host, the query, the operator's address, a secrets path, a bearer token.
 */
const NEEDLES = Object.freeze([
  'googleapis.com', 'chef@aromabistro741.com', 'C:\\Aroma\\secrets',
  'ya29.A0ARrdaMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxYYY', 'q=supplier', 'users/me/messages'
])

function assertNoLeak (haystack, where) {
  for (const n of NEEDLES) {
    assert.equal(String(haystack).includes(n), false, where + ' must not contain ' + n)
  }
}

/* ── 1. coverage error projection ─────────────────────────────────────────── */

test('*** a leaky adapter error becomes a CODE, and the detail is scrubbed ***', () => {
  const p = projectCoverageError(LEAKY)
  assert.ok(CODES.includes(p.code), 'the code is from the fixed set, got ' + p.code)
  assertNoLeak(p.code, 'the code')
  assertNoLeak(p.detail || '', 'the detail')
})

test('*** every failure shape maps to its code ***', () => {
  const cases = [
    ['read access disabled (flag off)', 'configured_off'],
    ['no source configured', 'configured_off'],
    ['GITHUB_READ_TOKEN not set', 'credential_unavailable'],
    ['gmail service unavailable (no google credentials)', 'credential_unavailable'],
    ['Request failed with status code 403 Forbidden', 'permission_denied'],
    ['read failed: Not Found', 'permission_denied'],
    ['timeout after 10000ms', 'timeout'],
    ['no adapter registered', 'source_unavailable'],
    ['something else entirely', 'read_failed']
  ]
  for (const [raw, code] of cases) {
    assert.equal(projectCoverageError(raw).code, code, raw)
  }
  assert.deepEqual(projectCoverageError(null), { code: null, detail: null }, 'no error stays no error')
})

test('*** CONTROL — a leaky error reaches NEITHER the response NOR the audit bytes ***', async () => {
  const dir = provisionedTmp()
  try {
    const store = createBriefStore({ dir, verifyAuditDir: () => ({ ok: true }) })
    const brief = draft()
    brief.sections.dataCoverage = [
      { source: 'gmail', state: 'unavailable', count: 0, errorCode: projectCoverageError(LEAKY).code, errorDetail: projectCoverageError(LEAKY).detail, usedFallback: false, retrievedAt: { iso: NOW } }
    ]
    brief.sections.risks = [factOf('r1', 'coverage:gmail', 'gmail could not be read: credential_unavailable', 'coverage_state')]

    const res = await post(routerWith({ buildMorningBriefingFn: builderReturning(brief), briefStore: store }))
    assert.equal(res.status, 200)
    assertNoLeak(JSON.stringify(res.body), 'the response body')

    const bytes = fs.readFileSync(path.join(dir, 'brief-audit.jsonl'), 'utf8')
    assertNoLeak(bytes, 'the audit file')
    // sourceStatuses is source/state/count only — no error field can even be stored.
    const rec = JSON.parse(bytes.split('\n')[0])
    for (const row of rec.sourceStatuses || []) {
      assert.deepEqual(Object.keys(row).sort(), ['count', 'source', 'state'])
    }
  } finally { rm(dir) }
})

/* ── 2. audit directory provisioning ──────────────────────────────────────── */

test('*** the runtime NEVER creates the audit directory ***', () => {
  const dir = path.join(os.tmpdir(), 'brief-audit-absent-' + process.pid)
  rm(dir)
  const store = createBriefStore({ dir })
  const r = store.write(record())
  assert.equal(r.ok, false)
  assert.equal(r.reason, PROVISION_FAILURE.MISSING, 'it refuses instead of mkdir-ing')
  assert.equal(fs.existsSync(dir), false, 'and the directory still does not exist')
})

test('*** each ACL defect has its own refusal ***', () => {
  const dir = provisionedTmp()
  try {
    const acl = (out) => verifyAuditDir(dir, { icacls: () => out })
    const OWNER = 'BOX\\louis:(OI)(CI)(F)'
    const BASE = dir + ' NT AUTHORITY\\SYSTEM:(OI)(CI)(F)\n BUILTIN\\Administrators:(OI)(CI)(F)\n ' + OWNER + '\n'

    assert.equal(acl(BASE).ok, true, 'a correct ACL passes')

    assert.equal(acl(dir + ' NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)\n BUILTIN\\Administrators:(F)\n ' + OWNER).reason,
      PROVISION_FAILURE.INHERITED, 'an inherited ACE means the provisioner has not run')
    assert.equal(acl(dir + ' BUILTIN\\Administrators:(F)\n ' + OWNER).reason, PROVISION_FAILURE.NO_SYSTEM)
    assert.equal(acl(dir + ' NT AUTHORITY\\SYSTEM:(F)\n ' + OWNER).reason, PROVISION_FAILURE.NO_ADMINS)
    assert.equal(acl(dir + ' NT AUTHORITY\\SYSTEM:(F)\n BUILTIN\\Administrators:(F)\n').reason,
      PROVISION_FAILURE.NO_OWNER, 'two machine principals and no human is not provisioned')
    assert.equal(acl(BASE + ' ' + OPERATOR_SID + ':(F)\n').reason,
      PROVISION_FAILURE.OPERATOR_PRESENT, 'AromaOperator by SID')
    assert.equal(acl(BASE + ' BOX\\AromaOperator:(RX)\n').reason,
      PROVISION_FAILURE.OPERATOR_PRESENT, 'and by name')
    assert.equal(acl('').reason, PROVISION_FAILURE.ACL_UNREADABLE)
    assert.equal(verifyAuditDir(dir, { icacls: () => { throw new Error('icacls missing') } }).reason,
      PROVISION_FAILURE.ACL_UNREADABLE)
  } finally { rm(dir) }
})

test('*** an unprovisioned ACL means stored:false, and the brief still arrives ***', async () => {
  const dir = provisionedTmp()
  try {
    const store = createBriefStore({ dir, icacls: () => dir + ' NT AUTHORITY\\SYSTEM:(I)(F)\n' })
    const res = await post(routerWith({ buildMorningBriefingFn: builderReturning(draft()), briefStore: store }))
    assert.equal(res.status, 200, 'the Owner still gets an answer')
    assert.equal(res.body.ok, true)
    assert.ok(res.body.brief, 'and the brief itself')
    assert.equal(res.body.stored, false)
    assert.equal(res.body.storeRefusal, PROVISION_FAILURE.INHERITED, 'a fixed enum, not a sentence')
    assert.equal(fs.existsSync(path.join(dir, 'brief-audit.jsonl')), false, 'nothing was written')
  } finally { rm(dir) }
})

/* ── 3. audit failure isolation ───────────────────────────────────────────── */

test('*** CONTROL — a THROWING disk sink still returns 200 and the same brief ***', async () => {
  const brief = draft()
  brief.sections.today = [factOf('t1', 'calendar', 'calendar contains a record: "Prep"', 'source_record')]

  const good = await post(routerWith({ buildMorningBriefingFn: builderReturning(brief) }))

  const exploding = createBriefStore({
    sink: () => { throw new Error('EPERM: operation not permitted, open ' + 'C:\\Aroma\\BriefAudit\\brief-audit.jsonl') }
  })
  const failed = await post(routerWith({ buildMorningBriefingFn: builderReturning(brief), briefStore: exploding }))

  assert.equal(failed.status, 200, 'an audit failure is not the Owner\'s problem')
  assert.equal(failed.body.stored, false)
  assert.equal(failed.body.storeRefusal, PROVISION_FAILURE.WRITE_FAILED, 'a fixed status')
  assertNoLeak(JSON.stringify(failed.body), 'the response')
  assert.equal(JSON.stringify(failed.body.brief), JSON.stringify(good.body.brief),
    'and the brief content is byte-identical to the successful run')
})

test('*** validator failure and audit failure are DIFFERENT outcomes ***', async () => {
  const v = await post(routerWith({
    buildMorningBriefingFn: builderReturning(draft()),
    validateBriefForDeliveryFn: () => { throw new Error('not_a_brief') }
  }))
  assert.equal(v.status, 500)
  assert.equal(v.body.error, 'delivery_validation_failed')
  assert.equal('brief' in v.body, false, 'fail-closed: no payload')

  const a = await post(routerWith({
    buildMorningBriefingFn: builderReturning(draft()),
    briefStore: createBriefStore({ sink: () => { throw new Error('EPERM') } })
  }))
  assert.equal(a.status, 200, 'an audit failure is NOT fail-closed')
  assert.ok(a.body.brief)
})

/* ── 4. derived statement scope ───────────────────────────────────────────── */

test('*** CONTROL — a recommendation claiming business_state is removed ***', async () => {
  const f = factOf('f1', 'gmail', 'gmail contains a record: "Weekly numbers"', 'source_record')
  const bad = {
    id: 'r1', kind: 'recommendation', text: 'Act on the numbers',
    provenance: null, basedOnFactIds: ['f1'], scope: 'business_state'
  }
  const brief = draft()
  brief.sections.recentActivity = [f]
  brief.sections.topPriorities = [bad]

  const v = validateBriefForDelivery(brief)
  assert.equal(v.brief.sections.topPriorities.length, 0, 'removed before delivery')
  assert.equal(v.removed[0].reason, REASON.DERIVED_SCOPE)
  assert.equal(v.brief.sections.recentActivity.length, 1, 'the gmail fact it cited is untouched')

  const res = await post(routerWith({ buildMorningBriefingFn: builderReturning(brief) }))
  assert.equal(JSON.stringify(res.body).includes('Act on the numbers'), false,
    'zero occurrences in the response bytes')
})

test('*** a derived item carrying provenance is removed ***', () => {
  const f = factOf('f1', 'gmail', 'gmail contains a record: "x"', 'source_record')
  const bad = {
    id: 'r1', kind: 'inference', text: 'therefore', scope: 'owner_work_item',
    basedOnFactIds: ['f1'], provenance: provOf('gmail', 'g1')
  }
  const b = draft(); b.sections.recentActivity = [f]; b.sections.topPriorities = [bad]
  const v = validateBriefForDelivery(b)
  assert.equal(v.brief.sections.topPriorities.length, 0)
  assert.equal(v.removed[0].reason, REASON.DERIVED_HAS_PROVENANCE)
})

test('*** business_state may only ever be a FACT from aroma-system ***', () => {
  const b = draft()
  b.sections.today = [factOf('f1', 'aroma-system', 'stock is 4 cases', 'business_state')]
  assert.equal(validateBriefForDelivery(b).brief.sections.today.length, 1,
    'the one source that may say it, may say it')

  const b2 = draft()
  b2.sections.today = [factOf('f2', 'gmail', 'gmail contains a record: "x"', 'business_state')]
  assert.equal(validateBriefForDelivery(b2).brief.sections.today.length, 0)
  assert.equal(validateBriefForDelivery(b2).removed[0].reason, REASON.SCOPE_MISMATCH)
})

test('*** POSITIVE CONTROL — a correct recommendation still survives ***', () => {
  const f = factOf('f1', 'proposals', 'Awaiting your decision: "Approve X"', 'owner_work_item')
  const r = { id: 'r1', kind: 'recommendation', text: 'decide it', provenance: null, basedOnFactIds: ['f1'], scope: 'owner_work_item' }
  const b = draft(); b.sections.decisionsNeeded = [f]; b.sections.topPriorities = [r]
  const v = validateBriefForDelivery(b)
  assert.equal(v.brief.sections.topPriorities.length, 1)
  assert.equal(v.outcome, OUTCOME.OK)
})

/* ── 5. provenance link safety ────────────────────────────────────────────── */

test('*** only https links, and only ones that parse ***', () => {
  assert.equal(linkIsSafe(null), true, 'absent is fine')
  assert.equal(linkIsSafe('https://mail.google.com/mail/u/0/#all/abc'), true)
  for (const bad of [
    'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>x</script>',
    'file:///C:/Aroma/secrets/google-refresh-token.json', 'http://insecure.example',
    'not a url at all', '', '//protocol-relative', 'vbscript:msgbox(1)'
  ]) {
    assert.equal(linkIsSafe(bad), false, bad + ' must be refused')
  }
})

test('*** CONTROL — an item with an unsafe link is removed before delivery ***', async () => {
  const b = draft()
  b.sections.today = [
    factOf('ok1', 'calendar', 'calendar contains a record: "Prep"', 'source_record'),
    Object.assign(factOf('bad1', 'gmail', 'gmail contains a record: "Click"', 'source_record'),
      { provenance: Object.assign(provOf('gmail', 'g1'), { link: 'javascript:alert(document.cookie)' }) })
  ]
  const v = validateBriefForDelivery(b)
  assert.equal(v.brief.sections.today.length, 1, 'only the safe one remains')
  assert.equal(v.removed[0].reason, REASON.UNSAFE_LINK)

  const res = await post(routerWith({ buildMorningBriefingFn: builderReturning(b) }))
  assert.equal(JSON.stringify(res.body).includes('javascript:'), false,
    'the scheme never reaches the browser')
})

test('*** incomplete provenance is removed, and is a DIFFERENT reason from a bad link ***', () => {
  const b = draft()
  const missingId = factOf('m1', 'gmail', 'gmail contains a record: "x"', 'source_record')
  delete missingId.provenance.sourceId
  b.sections.today = [missingId]
  assert.equal(validateBriefForDelivery(b).removed[0].reason, REASON.BAD_PROVENANCE)
})

/* ── harness ─────────────────────────────────────────────────────────────── */

function provOf (source, id) {
  return {
    source, sourceId: id, originalDate: { iso: NOW, display: 'Aug 02' },
    link: 'https://example.invalid/' + id, retrievedAt: { iso: NOW, display: 'Aug 02' }, usedFallback: false
  }
}

function factOf (id, source, text, scope) {
  return { id, kind: 'fact', text, provenance: provOf(source, id), basedOnFactIds: [], scope }
}

function draft () {
  return {
    briefId: 'brf_h', schemaVersion: 1, generatedAt: { iso: NOW, display: 'Aug 02' },
    timezone: 'America/Winnipeg',
    sections: {
      today: [], recentActivity: [], risks: [], topPriorities: [], decisionsNeeded: [],
      dataCoverage: [{ source: 'gmail', state: 'live', count: 1, errorCode: null, errorDetail: null, usedFallback: false, retrievedAt: { iso: NOW } }]
    },
    rejectedItems: []
  }
}

function record () {
  return {
    briefId: 'brf_h', generatedAt: NOW, schemaVersion: 1, provider: 'none', model: 'none',
    sourceStatuses: [{ source: 'gmail', state: 'live', count: 1 }], itemCounts: { today: 0 },
    durationMs: 1, contentHash: 'a'.repeat(64), outcome: 'ok'
  }
}

function builderReturning (brief) {
  return async () => ({
    brief,
    audit: {
      briefId: brief.briefId, generatedAt: NOW, schemaVersion: 1,
      sourceStatuses: brief.sections.dataCoverage.map((c) => ({ source: c.source, state: c.state, count: c.count })),
      itemCounts: {}, durationMs: 2
    }
  })
}

function routerWith (opts) {
  return createBriefingRouter(Object.assign({
    buildConnector: () => ({ connector: { read: async () => ({ results: [] }) } }),
    listPendingProposals: async () => [],
    buildDecisionRecall: async () => ({ count: 0 }),
    briefStore: createBriefStore({ persist: false })
  }, opts))
}

function provisionedTmp () { return fs.mkdtempSync(path.join(os.tmpdir(), 'brief-audit-')) }
function rm (d) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (_) { } }

function post (router) {
  const app = express()
  app.use(express.json())
  app.use(router)
  const server = http.createServer(app)
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/briefing/generate', method: 'POST' }, (r) => {
        let d = ''
        r.on('data', (c) => { d += c })
        r.on('end', () => { server.close(); resolve({ status: r.statusCode, body: JSON.parse(d) }) })
      })
      req.on('error', (e) => { server.close(); reject(e) })
      req.end()
    })
  })
}
