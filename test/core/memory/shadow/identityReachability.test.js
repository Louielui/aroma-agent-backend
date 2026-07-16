'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { tmpBase, cleanup } = require('../_helpers')

const SRC = path.resolve(__dirname, '../../../../src')

function resolveReq (fromDir, rel) {
  const base = path.resolve(fromDir, rel)
  for (const c of [base, base + '.js', path.join(base, 'index.js')]) {
    try { if (fs.statSync(c).isFile()) return c } catch (e) { /* keep trying */ }
  }
  return null
}

// Transitive set of LOCAL files reachable from an entrypoint via require('./...').
function reachableLocalFiles (entry) {
  const seen = new Set()
  const stack = [path.resolve(entry)]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    let src
    try { src = fs.readFileSync(f, 'utf8') } catch (e) { continue }
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
    let m
    while ((m = re.exec(src))) {
      const t = resolveReq(path.dirname(f), m[1])
      if (t) stack.push(t)
    }
  }
  return seen
}

test('runtime entrypoints (index.js, app.js) never transitively reach core/memory or shadow', () => {
  for (const entry of ['index.js', 'app.js']) {
    const reached = reachableLocalFiles(path.join(SRC, entry))
    const leaks = [...reached].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f))
    assert.deepEqual(leaks, [], `${entry} must not reach core/memory: ${leaks.join(', ')}`)
  }
})

test('buildPersonaSystem output is byte-identical regardless of an Identity shadow store', () => {
  const { buildPersonaSystem } = require('../../../../src/persona/xiangxiang')
  const before = buildPersonaSystem('CLASSIFIER_SYSTEM')
  const base = tmpBase()
  try {
    const { seedIdentity } = require('../../../../src/core/memory/shadow/identityShadow')
    const { PERSONA_IDENTITY } = require('../../../../src/persona/xiangxiang')
    seedIdentity(base, { personaIdentity: PERSONA_IDENTITY, approvalRef: 'g', rationale: 'r', sourceCommit: 'a8d230b998bb547578d70e602b318a91493a9595' })
    const after = buildPersonaSystem('CLASSIFIER_SYSTEM')
    assert.equal(after, before) // persona assembly does not read the shadow store
  } finally { cleanup(base) }
})
