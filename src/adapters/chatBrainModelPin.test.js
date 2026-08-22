'use strict'

/**
 * chatBrainModelPin.test.js — C3. The chat brain's model is deployment-controlled, and it is
 * the ONLY role that setting moves.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT THIS FILE IS ACTUALLY GUARDING, AND WHY A COMMENT WOULD NOT DO.
 *
 * `CLAUDE_MODEL` was traced at f706ca88 and found to be one value doing six jobs: the chat
 * brain, the goal decomposer inside that turn, the email-draft lane, the proposal /
 * work-order lane, the intent classifier that CREATES proposals, and the knowledge worker
 * that executes a dispatch. An Opus canary driven from that value is not a canary; it is a
 * silent migration of two work-order authorities and one executor.
 *
 * So the property under test is NOT 「chat can be pinned」. It is 「chat can be pinned AND
 * nothing else moves」 — a claim about the lanes that must NOT change, and those are
 * asserted here by name rather than left to a reader's confidence.
 *
 * ⛔ AND THE ROLLBACK IS TESTED AS A PROPERTY, NOT PROMISED IN PROSE. Absence of the value
 * must return the same object the caller has always had. A rollback that also depends on
 * remembering to revert code is not a rollback anyone can perform at 23:00.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/adapters/chatBrainModelPin.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { getAdapter, getAdapterForLane, REGISTRY, CHAT_LANE, CHAT_MODEL_ENV } = require('./adapterFactory')
const { ClaudeAdapter } = require('./ClaudeAdapter')
const { MockAdapter } = require('./MockAdapter')

const BASE = 'claude-haiku-4-5-20251001'   // what production runs today
const CANARY = 'claude-opus-5'             // the C2-FINAL candidate

/** Set/restore exactly the keys named. `null` means 「must be absent」, not 「empty」. */
async function withEnv (patch, fn) {
  const saved = {}
  for (const k of Object.keys(patch)) {
    saved[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('C3 (1) the chat lane, and only the chat lane, follows the pin', () => {
  test('*** ⛔ with the pin set, the CHAT adapter is the pinned model ***', async () => {
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      const a = getAdapterForLane(CHAT_LANE)
      assert.ok(a instanceof ClaudeAdapter, 'the chat lane must still receive a Claude adapter')
      assert.equal(a._model, CANARY)
    })
  })

  test('*** ⛔ SEEN TO MOVE — the same call without the pin is the base model ***', async () => {
    // A pin that happened to agree with the environment would pass the test above while
    // doing nothing at all. This is the half that proves the setting has an effect.
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: null }, () => {
      assert.equal(getAdapterForLane(CHAT_LANE)._model, BASE)
    })
  })

  test('*** ⛔ email_draft NEVER inherits the chat pin ***', async () => {
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      assert.equal(getAdapterForLane('email_draft')._model, BASE,
        '⛔ the Owner-visible draft lane was re-pointed by a chat experiment')
    })
  })

  test('*** ⛔ proposal — the WORK-ORDER lane — NEVER inherits the chat pin ***', async () => {
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      assert.equal(getAdapterForLane('proposal')._model, BASE,
        '⛔ the lane that produces the thing he types EXECUTE against was re-pointed')
    })
  })

  test('*** ⛔ every other caller — no lane named — is untouched ***', async () => {
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      // /api/v1/intake, the intent classifier that creates Proposals, and the dispatch
      // worker all reach getAdapter() with no lane at all. This pins the shape they share.
      assert.equal(getAdapterForLane()._model, BASE)
      assert.equal(getAdapterForLane(undefined)._model, BASE)
      assert.equal(getAdapter()._model, BASE)
    })
  })

  test('*** ⛔ a near-miss lane name is not the chat lane ***', async () => {
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      for (const near of ['Chat', ' chat', 'chat ', 'chatty', '']) {
        assert.equal(getAdapterForLane(near)._model, BASE,
          'lane matching must be exact: ' + JSON.stringify(near))
      }
    })
  })
})

describe('C3 (2) it selects a MODEL, never a PROVIDER', () => {
  test('*** ⛔ a non-claude provider ignores the pin entirely ***', async () => {
    await withEnv({ LLM_PROVIDER: 'mock', CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      const a = getAdapterForLane(CHAT_LANE)
      assert.ok(a instanceof MockAdapter, '⛔ a model name turned a mock into a live Anthropic client')
      assert.equal(a instanceof ClaudeAdapter, false)
    })
  })

  test('*** an unknown provider still throws the factory error, not a silent Claude ***', async () => {
    await withEnv({ LLM_PROVIDER: 'nope', CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      assert.throws(() => getAdapterForLane(CHAT_LANE), /unknown LLM_PROVIDER/)
    })
  })
})

describe('C3 (3) rollback is the ABSENCE of a value, and it fails back', () => {
  test('*** ⛔ blank and whitespace are NOT a model ***', async () => {
    for (const blank of ['', '   ', '\t', '\r\n']) {
      await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: blank }, () => {
        assert.equal(getAdapterForLane(CHAT_LANE)._model, BASE,
          '⛔ a half-cleared value left the chat lane on nothing: ' + JSON.stringify(blank))
      })
    }
  })

  test('*** a padded value is honoured, trimmed — a copy-paste must not fail closed ***', async () => {
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: '  ' + CANARY + ' ' }, () => {
      assert.equal(getAdapterForLane(CHAT_LANE)._model, CANARY)
    })
  })

  test('*** ⛔ deleting the value restores the base model with NO code change ***', async () => {
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      assert.equal(getAdapterForLane(CHAT_LANE)._model, CANARY)
      delete process.env[CHAT_MODEL_ENV]
      assert.equal(getAdapterForLane(CHAT_LANE)._model, BASE,
        '⛔ rollback required more than removing the value')
    })
  })

  test('*** ⛔ a blank pin takes the UNTOUCHED getAdapter() path, not a rebuilt one ***', async () => {
    // ⛔ FOUND BY MUTATION, AND THE MUTANT WAS RIGHT TO SURVIVE THE TEST ABOVE.
    //
    // Accepting a blank value in this seam changes NO model: `ClaudeAdapter` applies the very
    // same trim-and-reject rule for its own reasons, so a whitespace pin handed straight to it
    // still resolves to CLAUDE_MODEL. Asserting on `_model` alone therefore cannot tell
    // 「the seam refused」 from 「the adapter rescued it」, and a seam whose own guard had been
    // deleted would read as healthy for exactly as long as that rescue holds.
    //
    // So this watches WHICH PATH was taken, instead of where both paths happen to land.
    const SENTINEL = { providerName: 'registry-sentinel' }
    const real = REGISTRY.claude
    REGISTRY.claude = () => SENTINEL
    try {
      for (const blank of [null, '', '   ', '	']) {
        await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: blank }, () => {
          assert.equal(getAdapterForLane(CHAT_LANE), SENTINEL,
            '⛔ a blank pin built its own adapter instead of falling back: ' + JSON.stringify(blank))
        })
      }
      // And the other half, so the sentinel cannot pass by simply always being returned.
      await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
        const a = getAdapterForLane(CHAT_LANE)
        assert.notEqual(a, SENTINEL, 'a real pin must NOT take the fallback path')
        assert.equal(a._model, CANARY)
      })
    } finally { REGISTRY.claude = real }
  })

  test('*** the pin cannot resurrect the retired hardcoded default ***', async () => {
    // ClaudeAdapter fails closed when no model is chosen anywhere. The seam must not
    // reintroduce the built-in default that repair removed.
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: null, [CHAT_MODEL_ENV]: null }, () => {
      assert.equal(getAdapterForLane(CHAT_LANE)._model, null)
    })
  })
})

describe('C3 (4) the safety and control roles do NOT move', () => {
  test('*** ⛔ all four A4 roles stay on their own pins ***', async () => {
    await withEnv({ LLM_PROVIDER: null, CLAUDE_MODEL: BASE, [CHAT_MODEL_ENV]: CANARY }, () => {
      delete require.cache[require.resolve('../intake/a4Runtime')]
      const { A4_ROLES } = require('../intake/a4Runtime')
      assert.equal(A4_ROLES.sourceIntentResolver.model, 'gpt-5.6-terra')
      assert.equal(A4_ROLES.finalVerifier.model, 'gpt-5.6-terra')
      assert.equal(A4_ROLES.publicQueryPlanner.model, 'gpt-5.6-terra')
      assert.equal(A4_ROLES.recoveryWorker.model, 'claude-haiku-4-5-20251001')
      for (const r of Object.values(A4_ROLES)) {
        assert.notEqual(r.model, CANARY, '⛔ a safety role followed the chat canary')
      }
    })
  })

  test('*** ⛔ the recovery worker is pinned as a LITERAL, and cannot see the canary setting ***', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    for (const rel of ['../intake/a4Runtime.js', '../intake/intakeService.js']) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8')
      assert.match(src, /RECOVERY_WORKER_MODEL = 'claude-haiku-4-5-20251001'/,
        rel + ' must keep the recovery worker on its measured build')
      assert.doesNotMatch(src, new RegExp(CHAT_MODEL_ENV),
        '⛔ ' + rel + ' reads the chat canary setting — a safety role must not see it')
    }
  })

  test('*** ⛔ provider SELECTION is untouched by the pin ***', async () => {
    const { selectPrimaryProvider } = require('../routing/modelRouter')
    await withEnv({ MULTI_AI_ROUTER: 'on', [CHAT_MODEL_ENV]: CANARY }, () => {
      assert.equal(selectPrimaryProvider(process.env, { interactionMode: 'chat' }), 'openai')
      assert.equal(selectPrimaryProvider(process.env, { interactionMode: 'chat', providerHint: 'claude' }), 'claude')
      assert.equal(selectPrimaryProvider(process.env, { interactionMode: 'proposal' }), 'claude')
    })
    const fs = require('node:fs')
    const path = require('node:path')
    assert.doesNotMatch(
      fs.readFileSync(path.join(__dirname, '../routing/modelRouter.js'), 'utf8'),
      new RegExp(CHAT_MODEL_ENV),
      '⛔ the Multi-AI Router was drawn into a model decision')
  })
})

describe('C3 (5) the router hands over its OWN validated lane', () => {
  function makeApp (getAdapterFn, processIntakeFn) {
    const { createDemoRouter } = require('../routes/demoRouter')
    const app = express()
    app.use(express.json())
    app.locals.conversationDemo = true
    app.locals.promoteToProposal = async () => ({ ok: true, proposal: { id: 'p_t', status: 'pending' } })
    app.use(createDemoRouter({ getAdapterFn, processIntakeFn }))
    return app
  }
  async function post (app, body) {
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    try {
      const res = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/demo/intake', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
      return { status: res.status }
    } finally { server.close() }
  }

  test('*** ⛔ the lane the router validated is the lane the factory receives ***', async () => {
    const seen = []
    const fake = (lane) => { seen.push(lane); return { providerName: 'spy' } }
    const app = makeApp(fake, async () => ({ blocked: false, reply: 'ok', mode: 'chat' }))
    for (const sent of ['chat', 'email_draft', 'proposal']) {
      seen.length = 0
      await post(app, { message: 'hello', interactionMode: sent })
      assert.deepEqual(seen, [sent], 'lane ' + sent + ' must arrive verbatim')
    }
  })

  test('*** ⛔ a browser value outside the allowlist never reaches the factory at all ***', async () => {
    const seen = []
    const fake = (lane) => { seen.push(lane); return { providerName: 'spy' } }
    const app = makeApp(fake, async () => ({ blocked: false, reply: 'ok', mode: 'chat' }))
    const r = await post(app, { message: 'hello', interactionMode: 'chat; drop' })
    assert.equal(r.status, 400)
    assert.deepEqual(seen, [], '⛔ an unvalidated lane string reached model selection')
  })

  test('*** an injected factory that ignores the argument behaves exactly as before ***', async () => {
    let n = 0
    const legacy = () => { n++; return { providerName: 'spy' } }   // the pre-C3 zero-arg shape
    const app = makeApp(legacy, async () => ({ blocked: false, reply: 'ok', mode: 'chat' }))
    await post(app, { message: 'hello', interactionMode: 'chat' })
    assert.equal(n, 1)
  })
})
