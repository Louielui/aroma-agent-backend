'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const store = require('../../../src/core/memory/store')
const { tmpBase, cleanup, createRev, ev, activateIdentityLike } = require('./_helpers')

test('the four stores are independent: corrupting identity does not affect the others', () => {
  const base = tmpBase()
  try {
    // identity active
    createRev(base, 'identity', 'idA', { revisionId: 'r1' }); activateIdentityLike(base, 'identity', 'idA', 'r1')
    // personality active
    createRev(base, 'personality', 'peA', { revisionId: 'r1' }); activateIdentityLike(base, 'personality', 'peA', 'r1')
    // experience admitted
    createRev(base, 'experience', 'exA', { revisionId: 'r1' })
    ev(base, 'experience', 'exA', 'r1', 'CANDIDATE_CREATED', 'new')
    ev(base, 'experience', 'exA', 'r1', 'REVIEW_READY', 'candidate')
    ev(base, 'experience', 'exA', 'r1', 'APPROVED', 'review_ready', { approval: { approvedBy: 'louie', decision: 'approved' } })
    ev(base, 'experience', 'exA', 'r1', 'ADMITTED', 'approved')
    // skills active
    createRev(base, 'skills', 'skA', { revisionId: 'r1' })
    ev(base, 'skills', 'skA', 'r1', 'REGISTERED', 'new')
    ev(base, 'skills', 'skA', 'r1', 'APPROVED', 'registered', { approval: { approvedBy: 'louie', decision: 'approved' } })
    ev(base, 'skills', 'skA', 'r1', 'ACTIVATED', 'approved')

    // corrupt the identity revision
    const p = path.join(base, 'identity', 'records', 'idA', 'r1.json')
    fs.writeFileSync(p, 'garbage', 'utf8')

    assert.equal(store.resolveActiveRecord(base, 'identity', 'idA').status, 'NONE') // identity isolated
    assert.equal(store.resolveActiveRecord(base, 'personality', 'peA').status, 'ACTIVE')
    assert.equal(store.resolveActiveRecord(base, 'experience', 'exA').status, 'ACTIVE')
    assert.equal(store.resolveActiveRecord(base, 'skills', 'skA').status, 'ACTIVE')
  } finally { cleanup(base) }
})

test('experience cannot be admitted without a Louie approval event (no auto-admit)', () => {
  const base = tmpBase()
  try {
    createRev(base, 'experience', 'exB', { revisionId: 'r1' })
    ev(base, 'experience', 'exB', 'r1', 'CANDIDATE_CREATED', 'new')
    ev(base, 'experience', 'exB', 'r1', 'REVIEW_READY', 'candidate')
    // try to admit without approval -> invalid transition, no admission
    assert.throws(() => ev(base, 'experience', 'exB', 'r1', 'ADMITTED', 'review_ready'), (e) => e.code === 'INVALID_TRANSITION')
    assert.equal(store.resolveActiveRecord(base, 'experience', 'exB').status, 'NONE')
  } finally { cleanup(base) }
})
