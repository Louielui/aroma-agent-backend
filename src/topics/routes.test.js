'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express')
const { createTopicStore } = require('./workspaces'), { createTopicRouter } = require('./routes')
const { createConversationStore } = require('../store/conversationStore')
test('Owner topic API returns only linked history, retains notes across restart and rejects unsafe updates', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-topic-http-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const conversations = createConversationStore({ dataDir: dir }), store = createTopicStore({ dataDir: dir })
  for (const id of ['email-one', 'calendar-one']) conversations.appendTurn({ id, userText: 'Same title', replyText: 'Fixture reply' })
  store.link('email', 'email-one'); store.link('calendar', 'calendar-one')
  const app = express(); app.locals.conversationDemo = true; app.use(express.json())
  app.use('/api/v1/topic-workspaces', (req, res, next) => req.headers.authorization === 'Bearer fixture-owner' ? next() : res.sendStatus(401), createTopicRouter({ store, conversations }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port, url = base + '/api/v1/topic-workspaces/email'
  const request = (suffix = '', body, method = 'POST', origin = base) => fetch(url + suffix, { method: body ? method : 'GET', headers: { authorization: 'Bearer fixture-owner', origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  assert.equal((await fetch(url)).status, 401)
  const response = await request(); assert.equal(response.headers.get('cache-control'), 'no-store')
  const view = await response.json(); assert.deepEqual(view.conversations.map(c => c.id), ['email-one']); assert.equal(view.conversations[0].messages, undefined)
  const input = { requestId: 'note-fixture', title: 'Supplier follow-up', nextStep: 'Check delivery', source: { mailbox: 'admin', messageId: 'abcdef' } }
  assert.equal((await request('/notes', input, 'POST', 'https://outside.example')).status, 403)
  assert.equal((await request('/notes', { ...input, command: 'send' })).status, 400)
  const created = await (await request('/notes', input)).json(); assert.equal(created.note.state, 'todo')
  const updated = await request('/notes/' + created.note.id, { revision: 1, state: 'doing', nextStep: 'Ask supplier' }, 'PUT'); assert.equal(updated.status, 200)
  assert.equal((await request('/notes/' + created.note.id, { revision: 1, state: 'done', nextStep: '' }, 'PUT')).status, 409)
  assert.equal((await request('/conversations', { id: 'calendar-one' })).status, 409)
  assert.equal(createTopicStore({ dataDir: dir }).get('email').notes[0].nextStep, 'Ask supplier')
  app.locals.conversationDemo = false; assert.equal((await request()).status, 403)
})
test('workspace email discussion requests the original through the existing permission-checked reader in either language', () => {
  const { t: tr } = require('../i18n/t'), { gmailIntent } = require('../context/gmailContextService')
  for (const locale of ['zh', 'en']) {
    const message = tr('topic.discussEmail', { mailbox: locale === 'zh' ? '行政部' : 'administrative', id: 'abcdef' }, locale)
    assert.deepEqual(gmailIntent(message), { resource: 'gmail.admin_mail', operation: 'get', input: { messageId: 'abcdef' } })
    assert.ok(!message.includes('Fixture private body'))
  }
})
