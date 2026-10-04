'use strict'
// Drafting tests is a bounded text task. Keep coding effort independent and let
// the existing Claude review reject incomplete tests before any Owner approval.
function createDraftProvider ({ client = require('../../subscription/codexClient'), options }) {
  const model = 'gpt-6.1-sol', effort = 'medium'
  return {
    async preflight ({ signal } = {}) { return { ...await client.checkSubscription({ ...options, signal, model, effort }), effort } },
    complete (prompt, { system, schema, signal }) { return client.complete({ ...options, signal, timeoutMs: 240000 }, { prompt, system, schema, model, effort }) }
  }
}
module.exports = { createDraftProvider }
