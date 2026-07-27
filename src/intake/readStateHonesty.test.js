'use strict'

/**
 * readStateHonesty.test.js — END TO END, through the real service.
 *
 * The unit tests next door prove the guard's logic. This proves it is actually WIRED:
 * that the per-source outcome recorded at the read reaches the reply check on the paths
 * the Owner's turns travel, and that a false 讀唔到 cannot leave the service uncorrected.
 *
 * It also covers the second defect in the same brief — 「幫我睇 Calendar」, a read request,
 * answered with 「我未有建立提案」.
 *
 * No paid call: the adapter is a fake and the connector is a stub.
 */

const test = require('node:test')
const assert = require('node:assert')

const { processIntake } = require('./intakeService')

/** She denies the read. The connector below proves the read succeeded. */
const DENIAL = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '我目前讀唔到你的日程,你可以直接話我知今個星期有咩安排嗎?' })
const HONEST = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '你今個星期有兩件事。' })
const COMMIT = JSON.stringify({
  intent: 'do_it', mode: 'commit', reply: '好,你今個星期有兩件事:星期三同星期五。',
  understanding: 'u', judgment: 'j', decision: { statement: 's', rationale: 'r' },
  tasks: [{ title: 't', note: 'n', capability: 'ops' }], risks: [], next_step: 'n'
})

function fake (text) {
  return { async complete () { return { text, usage: { inputTokens: 10, outputTokens: 200, totalTokens: 210 }, model: 'f', latencyMs: 1 } } }
}

/** A calendar that WORKS — the live shape from the failing turn: 2 items, fallback used. */
function liveCalendar () {
  return {
    sources: ['calendar'],
    connector: {
      async read (source) {
        return {
          asOf: '2026-07-27', source, count: 2,
          results: [
            { source, sourceId: 'c1', title: 'Supplier call', retrievedAt: '2026-07-27', originalDate: '2026-08-04', content: 'x', link: 'l', trust: 'live', error: null },
            { source, sourceId: 'c2', title: 'Stock count', retrievedAt: '2026-07-27', originalDate: '2026-08-05', content: 'y', link: 'l', trust: 'live', error: null }
          ]
        }
      }
    }
  }
}

/** A calendar that genuinely FAILS. */
function deadCalendar () {
  return { sources: ['calendar'], connector: { async read () { throw new Error('token expired') } } }
}

const BASE_ENV = { READ_ACCESS: 'on', CONTEXT_CALENDAR: 'on', MULTI_AI_ROUTER: 'off', DECISION_RECALL: 'off', CONVERSATION_DEMO: 'on' }

async function withEnv (vars, fn) {
  const saved = {}
  const all = Object.assign({}, BASE_ENV, vars)
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/* ── 1. the fifth failure, caught in the running service ──────────────────── */

test('*** a live calendar + a reply claiming 讀唔到 is corrected before it leaves the service ***', async () => {
  await withEnv({}, async () => {
    const res = await processIntake('今個星期有咩安排?', fake(DENIAL), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar()
    })
    assert.equal(res.readClaimCorrected, true, 'the turn is flagged, so the failure is countable')
    assert.ok(res.reply.includes('系統更正'), 'and the correction is on screen, not only in a log')
    assert.ok(res.reply.includes('2 項'), 'stating the count that was actually read')
    assert.ok(res.reply.startsWith('我目前讀唔到'), 'her own words are preserved, not rewritten')
  })
})

test('an honest reply over the same live read is untouched', async () => {
  await withEnv({}, async () => {
    const res = await processIntake('今個星期有咩安排?', fake(HONEST), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar()
    })
    assert.equal(res.readClaimCorrected, false)
    assert.equal(res.reply, '你今個星期有兩件事。')
  })
})

test('*** when the calendar really IS down, 讀唔到 stands uncorrected ***', async () => {
  await withEnv({}, async () => {
    const res = await processIntake('今個星期有咩安排?', fake(DENIAL), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: deadCalendar()
    })
    assert.equal(res.readClaimCorrected, false, 'the honest state must survive the guard')
    assert.ok(!res.reply.includes('系統更正'))
  })
})

test('with READ_ACCESS off the guard is inert and the reply is byte-identical', async () => {
  await withEnv({ READ_ACCESS: 'off' }, async () => {
    const res = await processIntake('今個星期有咩安排?', fake(DENIAL), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar()
    })
    assert.equal(res.readClaimCorrected, false)
    assert.equal(res.reply, JSON.parse(DENIAL).reply)
  })
})

test('the interception path is guarded too — a denial there is corrected as well', async () => {
  const DENY_COMMIT = JSON.stringify(Object.assign(JSON.parse(COMMIT), { reply: '我讀唔到你的日曆,所以做唔到。' }))
  await withEnv({}, async () => {
    const res = await processIntake('幫我睇 Calendar', fake(DENY_COMMIT), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar()
    })
    assert.equal(res.readClaimCorrected, true)
    assert.ok(res.reply.includes('系統更正'))
  })
})

/* ── 2. the interception no longer over-fires on a read request ───────────── */

test('*** 「幫我睇 Calendar」 gets the answer, NOT 「我未有建立提案」 ***', async () => {
  await withEnv({}, async () => {
    const res = await processIntake('幫我睇 Calendar', fake(COMMIT), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar()
    })
    assert.ok(!res.reply.includes('我未有建立提案'), 'a lookup is not an attempt to make her act')
    assert.ok(res.reply.includes('星期三'), 'her real answer is returned')
  })
})

test('ordinary read instructions and questions are all exempt', async () => {
  await withEnv({}, async () => {
    for (const m of ['幫我睇 Calendar', '睇下今日有咩會', '查下 Gmail', '列出今個星期啲嘢', '今個星期有咩安排?', 'show me my calendar', 'check my email']) {
      const res = await processIntake(m, fake(COMMIT), [], {
        demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar()
      })
      assert.ok(!res.reply.includes('我未有建立提案'), 'must not misfire on: ' + m)
    }
  })
})

test('*** a read request still creates NOTHING — the safe direction is unchanged ***', async () => {
  await withEnv({}, async () => {
    let promoted = 0
    const res = await processIntake('幫我睇 Calendar', fake(COMMIT), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar(),
      promoteToProposal: async () => { promoted++; return { ok: true, proposal: { id: 'p1' } } }
    })
    assert.equal(promoted, 0, 'the promote seam is never called from the chat lane')
    assert.equal(res.talkOnly, true)
    assert.equal(res.decision, null, 'no decision, though the envelope carried one')
    assert.deepEqual(res.tasks, [], 'no task, though the envelope carried one')
    assert.equal('proposals' in res, false)
    assert.equal('workOrder' in res, false)
    assert.equal('agentExecute' in res, false)
  })
})

test('a real change instruction still gets the "say what to change" notice', async () => {
  await withEnv({}, async () => {
    const res = await processIntake('幫我搞掂晒啲嘢', fake(COMMIT), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar()
    })
    assert.ok(res.reply.includes('我未有建立提案'), 'the interception still holds where it should')
  })
})

test('a lookup that also asks for a change is NOT exempt', async () => {
  await withEnv({}, async () => {
    const res = await processIntake('睇下 docs/canary/agent-canary.md 然後改嗰行字', fake(COMMIT), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', readContextDeps: liveCalendar()
    })
    assert.ok(res.reply.includes('我未有建立提案'), 'a change verb overrides the read exemption')
  })
})
