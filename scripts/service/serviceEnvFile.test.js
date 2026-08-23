'use strict'

/**
 * serviceEnvFile.test.js — service.env MAY CARRY THREE CREDENTIALS AND NOTHING ELSE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE BLOCKER THIS CLOSES.
 *
 * The first parser applied every `KEY=value` it found. That turned an Administrator-written
 * file at a ProgramData path into a general runtime override channel: `READ_ACCESS=off`,
 * `AROMA_DATA_DIR=…`, `PERSONA_SOURCE=…` would all have been obeyed, silently, by the resident
 * production service. `runtimeContract.js` exists so ONE file decides what the assistant is; a
 * second file that can disagree is the superseded service's defect under a new name.
 *
 * ⛔ AND A TYPO IS NOT A NO-OP. An unknown key means the installer believed they configured
 * something. Starting anyway hides that belief instead of correcting it, so the FILE fails —
 * not merely the line.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test scripts/service/serviceEnvFile.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { ALLOWED_KEYS, parseServiceEnv, readServiceEnvFile, serviceEnvReport } = require('./serviceEnvFile')
const { INSTALL_TIME_REQUIRED, STABLE_ENV } = require('./runtimeContract')
const entry = require('./xiangxiang-service-entry')

const GOOD = ['# a comment', '', 'ANTHROPIC_API_KEY=a', 'HUB_TOKEN=b', 'CLAUDE_CHAT_MODEL=c', ''].join('\n')

describe('service.env is an allowlist, not an override channel', () => {
  test('*** ⛔ EXACTLY THE THREE INSTALL-TIME KEYS ARE ACCEPTED ***', () => {
    assert.deepEqual([...ALLOWED_KEYS].sort(), [...INSTALL_TIME_REQUIRED].sort())
    const r = parseServiceEnv(GOOD)
    assert.equal(r.ok, true)
    assert.deepEqual(Object.keys(r.values).sort(), [...INSTALL_TIME_REQUIRED].sort())
  })

  test('*** ⛔ AN UNKNOWN KEY FAILS THE FILE ***', () => {
    for (const k of ['PORT', 'AROMA_DATA_DIR', 'AROMA_ARTIFACT_DIR', 'AROMA_PROCESS_ROLE',
      'PERSONA_SOURCE', 'WORKER_INVOCATION', 'READ_ACCESS', 'LLM_PROVIDER', 'AGENT_BRIDGE']) {
      const r = parseServiceEnv(GOOD + '\n' + k + '=whatever')
      assert.equal(r.ok, false, '⛔ ' + k + ' was accepted')
      assert.deepEqual(r.unexpectedKeys, [k])
      assert.equal(k in r.values, false, '⛔ ' + k + ' reached the applied values')
    }
  })

  test('*** ⛔ A DUPLICATE KEY FAILS THE FILE — last-write-wins is a guess ***', () => {
    const r = parseServiceEnv('HUB_TOKEN=a\nHUB_TOKEN=b')
    assert.equal(r.ok, false)
    assert.deepEqual(r.duplicateKeys, ['HUB_TOKEN'])
  })

  test('*** ⛔ A MALFORMED NON-COMMENT LINE FAILS THE FILE ***', () => {
    for (const bad of ['this is not an assignment', '=novalue', 'lower_case=x', '9LEADING=x']) {
      const r = parseServiceEnv(bad)
      assert.equal(r.ok, false, '⛔ accepted: ' + bad)
      assert.equal(r.malformedLineCount + r.unexpectedKeys.length >= 1, true)
    }
  })

  test('blank lines and comments remain legal', () => {
    const r = parseServiceEnv('\n\n# only comments\n   \n# and blanks\n')
    assert.equal(r.ok, true)
    assert.equal(r.malformedLineCount, 0)
    assert.deepEqual(Object.keys(r.values), [])
  })

  test('*** ⛔ DIAGNOSTICS CARRY NAMES AND COUNTS, NEVER VALUES ***', () => {
    const r = parseServiceEnv('HUB_TOKEN=super-secret-value\nPORT=9999\nPORT=8888')
    const line = serviceEnvReport(Object.assign({ loaded: true }, r))
    assert.equal(line.includes('super-secret-value'), false, '⛔ a value reached a diagnostic')
    assert.match(line, /unexpectedKeys=PORT/)
    assert.match(line, /malformedLineCount=0/)
  })

  test('*** ⛔ service.env CANNOT CHANGE THE PORT, EVEN IF THE ALLOWLIST EVER LEAKED ***', () => {
    // Belt and braces: the allowlist refuses PORT, AND the contract is applied afterwards.
    const env = { AROMA_SERVICE_ENV_FILE: 'x' }
    const readFile = () => 'PORT=9999'
    const res = entry.loadServiceEnvFile(env, readFile)
    assert.equal(res.ok, false, 'the allowlist refuses it')
    entry.applyRuntimeContract(env)
    assert.equal(env.PORT, STABLE_ENV.PORT, '⛔ the port moved')
    assert.equal(env.PORT, '8090')
  })

  test('an absent or unreadable file is not-loaded, not a silent success with values', () => {
    const r = readServiceEnvFile('C:\nope\nothing-here.env')
    assert.equal(r.loaded, false)
    assert.deepEqual(r.values, {})
  })
})

describe('a configured service.env must actually be readable', () => {
  const base = { resolveRepo: () => ({ root: 'R', entry: 'R/src/index.js' }), log () {}, error () {}, chdir () {},
    checkMainBranch: () => ({ ok: true, state: 'on_main', ref: 'refs/heads/main' }) }
  const CREDS = { ANTHROPIC_API_KEY: 'a', HUB_TOKEN: 'b', CLAUDE_CHAT_MODEL: 'c' }
  const run = (env, deps) => {
    try { entry.main(env, Object.assign({}, base, deps)); return null } catch (x) { return x.message }
  }
  const boom = () => { throw new Error('EACCES C:/ProgramData/AromaXiangXiang/config/service.env') }

  test('*** ⛔ CONFIGURED + UNREADABLE REFUSES, EVEN WITH COMPLETE AMBIENT CREDENTIALS ***', () => {
    // This used to return ok:true/loaded:false, so a service pointed at a file it could not open
    // carried on — and if the three values also sat in the machine environment it started
    // SUCCESSFULLY, from ambient values, having silently ignored the file the installer wrote and
    // ACL'd. A wrong ACL is exactly what this file exists to surface.
    const msg = run(Object.assign({}, CREDS, { AROMA_SERVICE_ENV_FILE: 'X' }),
      { readFile: boom, start () { throw new Error('the server was started') } })
    assert.ok(msg, '⛔ it started from ambient credentials while ignoring a configured file')
    assert.match(msg, /configured but could not be read/)
    assert.match(msg, /may not stand in/)
  })

  test('*** ⛔ THE REFUSAL CARRIES NO PATH AND NO RAW EXCEPTION ***', () => {
    const msg = run(Object.assign({}, CREDS, { AROMA_SERVICE_ENV_FILE: 'X' }), { readFile: boom, start () {} })
    for (const leak of ['EACCES', 'ProgramData', 'C:/']) {
      assert.equal(msg.includes(leak), false, '⛔ the refusal leaked: ' + leak)
    }
    const r = readServiceEnvFile('X', boom)
    const line = serviceEnvReport(r)
    for (const leak of ['EACCES', 'ProgramData']) {
      assert.equal(line.includes(leak), false, '⛔ the log line leaked: ' + leak)
    }
    assert.match(line, /UNREADABLE/)
    assert.match(line, /configured=true/)
  })

  test('*** ⛔ NOT CONFIGURED IS A DIFFERENT FACT — ambient credentials remain supported ***', () => {
    let started = null
    const msg = run(Object.assign({}, CREDS), { start: (e) => { started = e; return 'ok' } })
    assert.equal(msg, null, 'no file configured, values present in the environment')
    assert.equal(started, 'R/src/index.js')
    const r = readServiceEnvFile(null)
    assert.equal(r.configured, false)
    assert.equal(r.ok, true)
    assert.equal(r.readable, null, 'readability is not a question that was asked')
  })

  test('configured + readable + valid still starts normally', () => {
    let started = null
    const msg = run({ AROMA_SERVICE_ENV_FILE: 'X' },
      { readFile: () => 'ANTHROPIC_API_KEY=a\nHUB_TOKEN=b\nCLAUDE_CHAT_MODEL=c', start: (e) => { started = e; return 'ok' } })
    assert.equal(msg, null)
    assert.equal(started, 'R/src/index.js')
  })

  test('*** ⛔ CONFIGURED + READABLE BUT REJECTED STILL REFUSES ***', () => {
    const msg = run(Object.assign({}, CREDS, { AROMA_SERVICE_ENV_FILE: 'X' }),
      { readFile: () => 'PORT=9999', start () { throw new Error('the server was started') } })
    assert.ok(msg && msg.includes('service.env rejected'), '⛔ an unknown key was tolerated')
    assert.match(msg, /unexpectedKeys=PORT/)
  })
})
