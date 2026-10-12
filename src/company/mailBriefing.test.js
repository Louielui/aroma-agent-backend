'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createGateway } = require('../core/operating/gateway')
test('briefing projects actionable mail with source evidence, unknown fields and review state', async () => {
  let available = true
  const gateway = createGateway({ mailMemory: { briefing: async () => {
    if (!available) throw Error('revoked')
    return { items: [{ id: 'thread', subject: 'Invoice', text: 'Owner original', status: 'active', decidedAt: '2026-09-29', source: { url: 'https://mail.google.com/mail/#all/abc' },
      details: { taskState: 'open', assignee: null, deadline: null, needsReview: true, analysis: { state: 'ready', category: 'follow_up', summary: 'New reply', change: { kind: 'cancellation' }, task: { text: 'Review cancellation' } } } }],
    total: 1, truncated: false, pending: 3, checkedAt: '2026-09-30T00:00:00Z' }
  } } })
  const result = await gateway.read({ role: 'owner' }, 'gmail.followups')
  assert.equal(result.state, 'ok'); assert.equal(result.source, 'admin_mail'); assert.equal(result.complete, false)
  assert.equal(result.rows[0].mailReview, true); assert.equal(result.rows[0].assignee, null)
  assert.equal(result.rows[0].mailCategory, 'follow_up'); assert.equal(result.rows[0].text, 'Owner original')
  assert.equal(result.rows[0].mailChange, 'cancellation'); assert.equal(result.rows[0].suggestion, 'Review cancellation')
  assert.equal(result.pendingAnalysis, 3)
  available = false; const blocked = await gateway.read({ role: 'owner' }, 'gmail.followups')
  assert.equal(blocked.count, null); assert.equal(blocked.rows, null)
  await assert.rejects(gateway.read({ role: 'member' }, 'gmail.followups'), /permission_denied/)
})
