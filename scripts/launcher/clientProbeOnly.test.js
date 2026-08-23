'use strict'

/**
 * clientProbeOnly.test.js — THE INTERACTIVE SIDE MUST NOT BE ABLE TO OWN THE SERVER.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FAILURE THIS CLOSES, MEASURED THREE TIMES.
 *
 * 香香 runs inside the interactive session because the Startup shortcut STARTS it there. A
 * logoff therefore ends production — most recently a 5h48m silent outage on 2026-08-23,
 * attributed to a Start-menu power action, with no crash anywhere in the evidence.
 *
 * Once a Windows service owns 8090, a second owner is not a safety net: it is a race for a port
 * and two histories in two data stores. So the replacement client may probe, open the UI, and
 * complain — and may not, under any circumstance, start a server.
 *
 * ⛔ THESE TESTS DRIVE THE REAL .ps1. Not a JS re-implementation of its logic — a second copy
 * would be the thing that drifts. A tiny fixture HTTP server stands in for the service, and the
 * actual PowerShell file is executed against it, so what is proven is what will run at logon.
 *
 * ⛔ AND THE SOURCE FENCE IS SEPARATE FROM THE BEHAVIOUR. Behaviour proves it did not start a
 * server this time; the fence proves it CANNOT. Comments are stripped first — a paragraph
 * explaining why node must never be invoked contains that word, and a naive scan reads the
 * explanation as the offence.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test scripts/launcher/clientProbeOnly.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')

const CLIENT = path.join(__dirname, 'xiangxiang-client.ps1')

/** A literal dollar sign, built rather than typed: this toolchain collapses escapes. */
const D = String.fromCharCode(36)

/** Comments are not code — see the header. */
const clientCode = () => fs.readFileSync(CLIENT, 'utf8')
  .replace(/<#[\s\S]*?#>/g, '')
  .split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n')

/**
 * Run the REAL client against a port.
 *
 * ⛔ ASYNC, AND THAT IS LOAD-BEARING. spawnSync BLOCKS THE EVENT LOOP, so the fixture server
 * in this very process can never accept the connection — every probe times out and every
 * state reads 「foreign」. Measured: curl against the fixture returned empty for the same
 * reason. A synchronous spawn here does not test the client, it tests a deadlock.
 */
function runClient (port) {
  return new Promise((resolve) => {
    const p = spawn('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CLIENT, '-Port', String(port), '-Mode', 'Probe', '-NoNotify'],
      { windowsHide: true })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    p.on('close', (code) => resolve({ code, out }))
  })
}

/** A stand-in for whatever holds the port. */
function serve (handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler)
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }))
  })
}
const close = (s) => new Promise((r) => s.close(r))

/**
 * ⛔ REMOVED ON PURPOSE: a global node-process count.
 *
 * It looked like the right question — 「did it start a server?」 — and it is not. Under
 * canonical concurrency the suite has dozens of node processes coming and going, so the
 * count moves for reasons unrelated to this client. Case B failed reporting a fallback
 * server that never existed. The precise question is whether anything is listening ON
 * THE PROBED PORT after the client exits, which `isListening` answers locally.
 */

const healthy = (req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', service: 'aroma-hub', bootCommit: 'x' }))
}
const net = require('node:net')

/** Is anything listening? Resolves true only on a completed connection. */
const isListening = (port) => new Promise((resolve) => {
  const sock = net.connect({ port, host: '127.0.0.1' })
  const done = (v) => { sock.destroy(); resolve(v) }
  sock.on('connect', () => done(true))
  sock.on('error', () => done(false))
  sock.setTimeout(1000, () => done(false))
})

/**
 * ⛔ A PORT PROVEN FREE, NOT MERELY VACATED.
 *
 * Under canonical concurrency dozens of test processes open ephemeral ports at once, and one
 * of them can take the number between our close() and the client probe. That made case B
 * report 「foreign」 instead of 「down」 — green alone, red in the full run. Confirm, then use.
 */
async function verifiedFreePort (attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const { server, port } = await serve(healthy)
    await close(server)
    if (!(await isListening(port))) return port
  }
  throw new Error('could not obtain a port proven free after ' + attempts + ' attempts')
}


describe('the double-start matrix — the client never becomes a second owner', () => {
  test('*** ⛔ A — SERVICE HEALTHY: recognised as ours, nothing started ***', async () => {
    const { server, port } = await serve(healthy)
    const r = await runClient(port)
    await close(server)
    assert.match(r.out, /CLIENT_STATE=ours/, r.out)
    assert.equal(r.code, 0)
    assert.equal(await isListening(port), false, '⛔ a node process appeared')
  })

  test('*** ⛔ B — PORT DOWN: reported, and STILL nothing started ***', async () => {
    // Nothing is listening. The old launcher's answer here was to START the server; this one's
    // answer is to say so. That single difference is the whole tranche.
    const port = await verifiedFreePort()
    const r = await runClient(port)
    assert.match(r.out, /CLIENT_STATE=down/, r.out)
    assert.equal(r.code, 4)
    assert.equal(await isListening(port), false, '⛔ the client started a fallback server')
  })

  test('*** ⛔ C — FOREIGN HOLDER: fail closed, no kill, no alternate port, no start ***', async () => {
    const { server, port } = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', service: 'something-else' }))
    })
    const r = await runClient(port)
    const stillUp = server.listening
    await close(server)
    assert.match(r.out, /CLIENT_STATE=foreign/, r.out)
    assert.equal(r.code, 3)
    assert.equal(stillUp, true, '⛔ the client killed the foreign holder')
    assert.equal(await isListening(port), false, '⛔ the client started a server anyway')
  })

  test('*** ⛔ D — PORT HELD BUT UNHEALTHY: still foreign, still no second server ***', async () => {
    const { server, port } = await serve((req, res) => { res.writeHead(500); res.end('unwell') })
    const r = await runClient(port)
    await close(server)
    assert.match(r.out, /CLIENT_STATE=foreign/, r.out)
    assert.equal(r.code, 3)
    assert.equal(await isListening(port), false, '⛔ an unhealthy service was 「helped」 by a second one')
  })

  test('*** ⛔ E — RECOVERED LATER: the next probe reads ours normally ***', async () => {
    const { server, port } = await serve(healthy)
    const r = await runClient(port)
    await close(server)
    assert.match(r.out, /CLIENT_STATE=ours/, r.out)
    assert.equal(r.code, 0)
  })
})

describe('the fence: it cannot start a server even if someone wanted it to', () => {
  test('*** ⛔ NO INTERPRETER INVOCATION ANYWHERE IN THE CLIENT ***', () => {
    const code = clientCode()
    const banned = ['node ', 'node.exe', 'xiangxiang-body', 'Invoke-Expression',
      'iex ', 'powershell', 'pwsh', 'cmd /c', 'Start-Job', 'index.js']
    for (const b of banned) {
      assert.equal(code.includes(b), false, '⛔ the client can start something: ' + b)
    }
  })

  test('*** ⛔ ITS ONLY Start-Process IS A URL HANDED TO THE SHELL ***', () => {
    const hits = clientCode().match(/Start-Process[^\r\n]*/g) || []
    assert.equal(hits.length, 1, '⛔ more than one launch site: ' + hits.join(' | '))
    assert.ok(hits[0].includes('Start-Process ' + D + 'UiUrl'), '⛔ it launches something other than the constructed UI URL: ' + hits[0])
  })

  test('*** ⛔ -NoNotify SUPPRESSES THE MODAL ONLY — the notification path still exists ***', () => {
    const code = clientCode()
    assert.ok(code.includes('MessageBox]::Show'), '⛔ the human notification was removed, not suppressed')
    assert.ok(code.includes('if (' + D + "NoNotify) {"), 'the switch guards only the modal')
    // It must not be able to influence what the client DOES about the port.
    const decisive = code.split('switch (' + D + "state)")[1] || ''
    assert.equal(decisive.includes('NoNotify'), false, '⛔ the switch reaches the decision')
  })

  test('the old launcher is untouched — it remains the owner until the cutover GO', () => {
    const body = path.join(__dirname, 'xiangxiang-body.ps1')
    assert.ok(fs.existsSync(body))
    assert.match(fs.readFileSync(body, 'utf8'), /Start-Process node/,
      'the interactive launcher still starts the server, deliberately, for now')
  })
})

describe('the UI target is constructed, never supplied', () => {
  /** Invoke with arbitrary extra arguments, so parameter binding itself is under test. */
  function runRaw (args) {
    return new Promise((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CLIENT, ...args],
        { windowsHide: true })
      let out = ''
      p.stdout.on('data', (d) => { out += d })
      p.stderr.on('data', (d) => { out += d })
      p.on('close', (code) => resolve({ code, out }))
    })
  }

  test('*** ⛔ -Url node.exe IS REFUSED, NOT IGNORED ***', async () => {
    // Measured: WITHOUT [CmdletBinding()] PowerShell silently swallowed the unknown parameter
    // and ran normally. Ignoring is not refusing — a caller who believes they supplied a launch
    // target must be told they did not, and the point of this script is that none exists.
    const before = await isListening(59997)
    const r = await runRaw(['-Port', '59997', '-Mode', 'Open', '-Url', 'node.exe', '-NoNotify'])
    assert.notEqual(r.code, 0, '⛔ the unknown parameter was accepted')
    assert.match(r.out, /A parameter cannot be found/i, r.out)
    assert.match(r.out, /NamedParameterNotFound/i, r.out)
    assert.equal(await isListening(59997), before, '⛔ something came up on the probed port')
  })

  test('*** ⛔ THERE IS NO CALLER-SUPPLIED LAUNCH TARGET IN THE PARAMETER BLOCK ***', () => {
    const code = clientCode()
    const block = code.slice(code.indexOf('param('), code.indexOf(')', code.indexOf('param(')))
    assert.equal(block.includes('Url'), false, '⛔ a target parameter is back: ' + block)
    assert.ok(code.includes('[CmdletBinding()]'), 'strict binding is what makes the refusal an error')
    // the one launch site takes the internally-built value
    assert.ok(code.includes('Start-Process ' + D + 'UiUrl'), '⛔ Start-Process no longer takes the constructed URL')
  })

  test('*** ⛔ THE CONSTRUCTED TARGET IS LOOPBACK HTTP, BUILT FROM THE PROBED PORT ***', () => {
    const code = clientCode()
    assert.ok(code.includes(D + "UiUrl = 'http://127.0.0.1:' + " + D + "Port + '/demo'"),
      '⛔ the UI target is not built from the port this script probed')
    // no other scheme, no other host
    const urls = code.match(/'https?:\/\/[^']*'/g) || []
    for (const u of urls) {
      assert.match(u, /^'http:\/\/127\.0\.0\.1/, '⛔ a non-loopback target appeared: ' + u)
    }
  })
})
