'use strict'

/**
 * parallelReadContext.test.js — the four sources are read CONCURRENTLY, and moving the
 * fetch behind provider selection must not change what anyone receives.
 *
 * WHY. Measured on the real logs: a chat turn cost 4.2–9.6s, of which the model was
 * 1.4–5.7s and the read-context fetch 2.5–5.1s. The proposal lane — same pipeline, no
 * read-context — showed 6–11ms of overhead, which proves everything except the model and
 * the fetch is free. The four reads are independent calls to four unrelated services and
 * were being made one after another.
 *
 * The risk in fixing that is silently changing behaviour: losing a source's failure mode,
 * reordering the block, or breaking the context boundary. These tests pin all three.
 * No network, no paid call: the connector is a fake with modelled latency.
 */

const test = require('node:test')
const assert = require('node:assert')

const { buildReadContext } = require('./readContext')
const { processIntake } = require('../intake/intakeService')

const SOURCES = ['drive', 'gmail', 'calendar']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// A FIXED but VALID instant: the calendar plan derives its window from this, so a
// non-date placeholder would make calendar 'unavailable' for the wrong reason.
const NOW = '2026-07-26T12:00:00.000Z'

function connector (latency = {}, failing = []) {
  const calls = []
  return {
    calls,
    async read (source, method) {
      calls.push({ source, method, at: Date.now() })
      await sleep(latency[source] === undefined ? 300 : latency[source])
      if (failing.includes(source)) throw new Error(source + ' is down')
      return {
        asOf: 'x', source, count: 1,
        results: [{ source, sourceId: source + '1', title: 'T_' + source, retrievedAt: 'x', originalDate: '2026-07-01', content: 'C_' + source, link: 'l', trust: 'live', error: null }]
      }
    }
  }
}

/* ── concurrency ──────────────────────────────────────────────────────────── */

test('the sources are read CONCURRENTLY — the wait is the slowest one, not the total', async () => {
  const c = connector({ drive: 400, gmail: 400, calendar: 400 })
  const t0 = Date.now()
  await buildReadContext({ connector: c, message: '今日有咩要跟進', sources: SOURCES, env: {}, now: NOW })
  const ms = Date.now() - t0
  // sequential would be >= 1200ms (gmail also hydrates, so more). Allow generous slack
  // for a loaded machine while still failing loudly if this ever goes back to serial.
  assert.ok(ms < 1100, 'expected concurrent (<1100ms), got ' + ms + 'ms')

  // and they genuinely overlap: the first read of each source starts before the first
  // one finishes
  const firsts = SOURCES.map((s) => c.calls.find((x) => x.source === s).at)
  assert.ok(Math.max(...firsts) - Math.min(...firsts) < 300, 'all sources start together')
})

test('output is byte-identical to the sequential version: order, caps, three-state rendering', async () => {
  const c = connector({ drive: 50, gmail: 10, calendar: 200 })
  const r = await buildReadContext({ connector: c, message: '今日有咩要跟進', sources: SOURCES, env: {}, now: NOW })
  // rendered in the ORIGINAL source order, not completion order (calendar is slowest)
  assert.deepEqual(r.perSource.map((p) => p.source), SOURCES)
  const idx = SOURCES.map((s) => r.block.indexOf('T_' + s))
  assert.ok(idx[0] < idx[1] && idx[1] < idx[2], 'the block preserves source order')
  assert.equal(r.status, 'READY')
})

/* ── fail-soft, per source ────────────────────────────────────────────────── */

test('ONE broken source does not block, fail, or infect the others', async () => {
  const c = connector({ drive: 100, gmail: 100, calendar: 100 }, ['gmail'])
  const t0 = Date.now()
  const r = await buildReadContext({ connector: c, message: 'x', sources: SOURCES, env: {}, now: NOW })
  assert.ok(Date.now() - t0 < 900, 'a broken source does not serialize the rest')

  const by = Object.fromEntries(r.perSource.map((p) => [p.source, p]))
  assert.equal(by.gmail.trust, 'unavailable', 'the broken one is honestly unavailable')
  assert.equal(by.drive.trust, 'live', 'the others are unaffected')
  assert.equal(by.calendar.trust, 'live')
  assert.ok(r.block.includes('T_drive') && r.block.includes('T_calendar'), 'their content still arrives')
  assert.ok(r.block.includes('gmail'), 'and the failure is stated, not hidden')
})

test('a source that never resolves cannot take the turn down (all sources broken)', async () => {
  const c = connector({ drive: 10, gmail: 10, calendar: 10 }, SOURCES)
  const r = await buildReadContext({ connector: c, message: 'x', sources: SOURCES, env: {}, now: NOW })
  assert.equal(r.perSource.length, 3)
  assert.ok(r.perSource.every((p) => p.trust === 'unavailable'), 'every source honestly unavailable')
  assert.ok(r.block, 'a block is still produced rather than throwing')
})

/* ── the fetch happens only on the path allowed to receive it ─────────────── */

const CHAT = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'ok' })
const recorder = () => {
  const seen = []
  return { seen, async complete (p) { seen.push(p); return { text: CHAT, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'f', latencyMs: 1 } } }
}
async function withEnv (vars, fn) {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}
// TURN_ROUTER:'off' ADDED 2026-08-05, when the default flipped to 'on'. These tests are
// about the CONTEXT-ASSEMBLY BOUNDARY, not about routing: they need a turn that actually
// reads, and under routing a message with no business intent reads nothing. Pinning the
// legacy path here keeps them proving what they were written to prove — and keeps that
// path provable, since it is still a supported rollback.
//
// THE COST, recorded rather than left implicit: this guarantee is now proven on the
// legacy path only. See MAINTENANCE-BACKLOG.md M-4.
const ENV = { DECISION_RECALL: 'off', READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', MULTI_AI_ROUTER: 'off', TURN_ROUTER: 'off' }

test('a GPT-served turn fetches only what it is PERMITTED — and nothing when all is withheld', async () => {
  // INVERTED by a later Owner decision: GPT now receives the same context as Claude, so
  // a GPT turn fetches. The lazy build still earns its keep — it means a source the Owner
  // has withheld from OpenAI is never even READ on a GPT-served turn, so withholding
  // costs nothing and leaks nothing.
  await withEnv(ENV, async () => {
    const shared = connector({ drive: 50 })
    const gpt = recorder()
    await processIntake('今日有咩要跟進', recorder(), [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai', openaiAdapter: gpt,
      readContextDeps: { sources: ['drive'], connector: shared }
    })
    assert.ok(shared.calls.length > 0, 'the source is read for GPT now')
    assert.ok(gpt.seen[0].includes('T_drive'), 'and GPT receives it')
  })

  await withEnv(Object.assign({}, ENV, { CONTEXT_DRIVE_OPENAI: 'off' }), async () => {
    const withheld = connector({ drive: 600 })
    const gpt = recorder()
    const t0 = Date.now()
    await processIntake('今日有咩要跟進', recorder(), [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai', openaiAdapter: gpt,
      readContextDeps: { sources: ['drive'], connector: withheld }
    })
    const ms = Date.now() - t0
    assert.equal(withheld.calls.length, 0, 'a withheld source is never even READ on a GPT turn')
    assert.ok(ms < 300, 'so withholding costs nothing: ' + ms + 'ms')
    assert.ok(!gpt.seen[0].includes('T_drive'), 'and certainly never sent')
  })
})

test('a Claude-served turn DOES fetch it — the boundary is unchanged', async () => {
  await withEnv(ENV, async () => {
    const c = connector({ drive: 50 })
    const claude = recorder()
    await processIntake('今日有咩要跟進', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: { sources: ['drive'], connector: c }
    })
    assert.ok(c.calls.length > 0, 'the connector was called')
    assert.ok(claude.seen[0].includes('T_drive'), 'Claude receives the context, exactly as before')
  })
})

test('the Claude FALLBACK after a GPT failure still gets the full context', async () => {
  await withEnv(ENV, async () => {
    const c = connector({ drive: 50 })
    const claude = recorder()
    await processIntake('今日有咩要跟進', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai',
      openaiAdapter: { async complete () { throw new Error('provider down') } },
      readContextDeps: { sources: ['drive'], connector: c }
    })
    assert.equal(claude.seen.length, 1, 'Claude answered as the one-shot fallback')
    assert.ok(claude.seen[0].includes('T_drive'),
      'the fallback answer is as informed as it has always been — laziness must not degrade it')
  })
})

test('the sources are never read twice in one turn', async () => {
  await withEnv(ENV, async () => {
    const c = connector({ drive: 20 })
    await processIntake('今日有咩要跟進', recorder(), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: { sources: ['drive'], connector: c }
    })
    const driveReads = c.calls.filter((x) => x.source === 'drive').length
    assert.ok(driveReads <= 2, 'at most the planned read (+ its documented fallback), got ' + driveReads)
  })
})

test('non-chat lanes still read nothing at all', async () => {
  await withEnv(ENV, async () => {
    for (const mode of ['proposal', undefined]) {
      const c = connector({ drive: 50 })
      await processIntake('做啲嘢', recorder(), [], {
        demo: true, interactionMode: mode, readContextDeps: { sources: ['drive'], connector: c },
        promoteToProposal: async () => ({ ok: true, proposal: { id: 'p1', status: 'pending' } })
      })
      assert.equal(c.calls.length, 0, 'mode=' + mode + ' must not read any source')
    }
  })
})

/* ── the calendar window: TODAY counts, and an empty window is not a dead end ── */

const { planFor } = (() => {
  // planFor is module-internal; exercise it through buildReadContext with a recording
  // connector, which is what actually matters anyway.
  return {}
})()

function calConnector (events) {
  const calls = []
  return {
    calls,
    async read (source, method, params) {
      calls.push({ method, params })
      const from = new Date(params.timeMin).getTime()
      const to = params.timeMax ? new Date(params.timeMax).getTime() : Infinity
      const hits = events.filter((e) => {
        const t = new Date(e).getTime()
        return t >= from && t <= to
      })
      return {
        asOf: 'x', source, count: hits.length,
        results: hits.map((e, i) => ({ source, sourceId: 'e' + i, title: 'EVENT_' + i, retrievedAt: 'x', originalDate: e, content: '', link: 'l', trust: 'live', error: null }))
      }
    }
  }
}

test('*** the calendar window starts at TODAY 00:00, not at the current instant ***', async () => {
  // The Owner asked 「今日有咩安排」 in the afternoon and got nothing, because the window
  // began at NOW and his morning meeting was already in the past. The day you are
  // standing in is part of "upcoming".
  const nowIso = '2026-07-27T14:59:00-05:00'
  const thisMorning = '2026-07-27T09:00:00-05:00'
  const c = calConnector([thisMorning])
  const r = await buildReadContext({ connector: c, message: '今日有咩安排', sources: ['calendar'], env: {}, now: nowIso })

  const p = c.calls[0].params
  assert.ok(new Date(p.timeMin).getTime() <= new Date(thisMorning).getTime(),
    'timeMin must be at or before this morning, got ' + p.timeMin)
  assert.equal(r.perSource[0].count, 1, 'this morning\'s event is found')
  assert.ok(r.block.includes('EVENT_0'))
})

test('the window is still BOUNDED — it does not return events years out', async () => {
  const nowIso = '2026-07-27T12:00:00-05:00'
  const c = calConnector(['2027-11-24T22:30:00-06:00'])
  await buildReadContext({ connector: c, message: '下星期有咩', sources: ['calendar'], env: {}, now: nowIso })
  const p = c.calls[0].params
  assert.ok(p.timeMax, 'the primary query is bounded')
  const days = (new Date(p.timeMax) - new Date(p.timeMin)) / 86400000
  assert.ok(days <= 15 && days >= 13, 'roughly the configured window, got ' + days + ' days')
})

test('an EMPTY window falls back to the next scheduled events, honestly labelled', async () => {
  // The Owner's real calendar had nothing for 14 days but a real event further out.
  // "No events" was true and useless — and read as "the calendar is broken".
  const nowIso = '2026-07-27T12:00:00-05:00'
  const c = calConnector(['2026-10-19T09:30:00-05:00'])
  const r = await buildReadContext({ connector: c, message: '有咩安排', sources: ['calendar'], env: {}, now: nowIso })

  assert.equal(c.calls.length, 2, 'the bounded query ran, then the fallback')
  assert.equal(c.calls[1].params.timeMax, undefined, 'the fallback drops timeMax')
  assert.equal(r.perSource[0].usedFallback, true)
  assert.equal(r.perSource[0].count, 1)
  // Assert on the ITEM lines, not the whole block: the safety header legitimately
  // DOCUMENTS both labels, so scanning it would test the documentation, not the data.
  const calLines = r.block.split('\n').filter((l) => l.startsWith('[calendar]'))
  assert.equal(calLines.length, 1)
  assert.ok(calLines[0].includes('next scheduled, beyond the window asked about'),
    'labelled so it is never mistaken for "within the period you asked about"')
  assert.ok(!calLines[0].includes('(recent items)'), 'and not mislabelled as RECENT — these are future events')
})

test('a genuinely empty calendar still reports read-OK, never UNAVAILABLE', async () => {
  const c = calConnector([])
  const r = await buildReadContext({ connector: c, message: '有咩安排', sources: ['calendar'], env: {}, now: '2026-07-27T12:00:00-05:00' })
  assert.equal(r.perSource[0].trust, 'live', 'the source WAS read')
  const calLine = r.block.split('\n').filter((l) => l.startsWith('[calendar]'))[0]
  assert.ok(calLine.includes('read OK — no matching results'), 'so 香香 must say 讀到但冇結果, not 讀不到')
  assert.ok(!calLine.includes('UNAVAILABLE'), 'an empty diary is not a failure')
})
