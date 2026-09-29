'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRegistry, createGateway } = require('./access')

function setup () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-access-'))
  const registry = createRegistry({ file: path.join(dir, 'registry.json') })
  registry.bind({ sub: 'ivy-sub', email: 'ivy.chow@aromabistro741.com', email_verified: true, hd: 'aromabistro741.com' })
  return { registry, file: path.join(dir, 'registry.json') }
}
test('identity binds verified Workspace subject, rejects substitutes and persists revocation', () => {
  const { registry, file } = setup()
  assert.throws(() => registry.bind({ sub: 'thief', email: 'ivy.chow@aromabistro741.com', email_verified: true, hd: 'aromabistro741.com' }))
  assert.throws(() => registry.bind({ sub: 'owner-sub', email: 'louie@aromabistro741.com', email_verified: true }))
  assert.throws(() => registry.bind({ sub: 'other', email: 'unknown@aromabistro741.com', email_verified: true, hd: 'aromabistro741.com' }))
  assert.equal(registry.allowed('ivy-sub', 'admin-drive'), true)
  assert.equal(registry.allowed('ivy-sub', 'company-drive'), false)
  registry.setGrant('ivy', 'admin-drive', false)
  assert.equal(createRegistry({ file }).allowed('ivy-sub', 'admin-drive'), false)
  registry.setGrant('ivy', 'admin-drive', true)
  registry.suspend('ivy', true)
  assert.equal(registry.allowed('ivy-sub', 'admin-drive'), false)
  assert.throws(() => registry.bind({ sub: 'ivy-sub', email: 'ivy.chow@aromabistro741.com', email_verified: true, hd: 'aromabistro741.com' }))
})
test('direct IDs require live source access and ancestry; shortcuts and foreign folders fail closed', async () => {
  const { registry } = setup()
  const admin = registry.snapshot().sources.find(s => s.id === 'admin-drive').rootId
  const root = registry.snapshot().sources.find(s => s.id === 'company-drive').rootId
  const files = { [root]: { id: root, mimeType: 'application/vnd.google-apps.folder', driveId: root },
    [admin]: { id: admin, parents: [root], driveId: root, mimeType: 'application/vnd.google-apps.folder' },
    good: { id: 'good', name: 'Admin memo', parents: [admin], driveId: root },
    private: { id: 'private', name: 'Private memo', parents: [root], driveId: root },
    shortcut: { id: 'shortcut', parents: [admin], driveId: root, mimeType: 'application/vnd.google-apps.shortcut' } }
  let upstream = true
  const gateway = createGateway({ registry, getFile: async (_session, id) => { if (!upstream || !files[id]) throw Error('source_denied'); return files[id] } })
  const session = { sub: 'ivy-sub' }
  assert.equal((await gateway.read(session, 'admin-drive', 'good')).name, 'Admin memo')
  await assert.rejects(gateway.read(session, 'admin-drive', 'private'))
  await assert.rejects(gateway.read(session, 'admin-drive', 'shortcut'))
  await assert.rejects(gateway.read(session, 'company-drive', 'good'))
  upstream = false
  await assert.rejects(gateway.read(session, 'admin-drive', 'good'))
})
test('revocation during a read and mixed-source derived references cannot leak', async () => {
  const { registry } = setup()
  const admin = registry.snapshot().sources.find(s => s.id === 'admin-drive').rootId
  const root = registry.snapshot().sources.find(s => s.id === 'company-drive').rootId
  const gateway = createGateway({ registry, getFile: async (_s, id) => {
    if (id === 'memo') registry.setGrant('ivy', 'admin-drive', false)
    return { id, driveId: root, parents: id === 'memo' ? [admin] : [root] }
  } })
  await assert.rejects(gateway.read({ sub: 'ivy-sub' }, 'admin-drive', 'memo'))
  registry.setGrant('ivy', 'admin-drive', true)
  assert.equal(await gateway.referencesAllowed({ sub: 'ivy-sub' }, []), false)
  assert.equal(await gateway.referencesAllowed({ sub: 'ivy-sub' }, [{ sourceId: 'admin-drive', fileId: admin }, { sourceId: 'company-drive', fileId: root }]), false)
  registry.setGrant('ivy', 'admin-drive', false)
  assert.equal(await gateway.referencesAllowed({ sub: 'ivy-sub' }, [{ sourceId: 'admin-drive', fileId: admin }]), false)
})
test('unconnected mailbox cannot become readable through a grant', () => {
  const { registry } = setup()
  assert.throws(() => registry.setGrant('ivy', 'admin-mail', true))
  assert.equal(registry.allowed('ivy-sub', 'admin-mail'), false)
  assert.equal(registry.snapshot().sources.find(s => s.id === 'admin-mail').state, 'not_connected')
})
test('listings expose allowed metadata, report truncation and reject Google-side revocation', async () => {
  const { registry } = setup()
  const admin = registry.source('admin-drive').rootId; const root = registry.source('admin-drive').driveId
  let revoked = false
  const gateway = createGateway({ registry,
    getFile: async (_s, id) => {
      if (revoked) throw Error('Google 403')
      return { id, driveId: root, name: id === 'memo' ? 'Verified memo' : 'Admin', parents: id === 'memo' ? [admin] : [root],
        mimeType: id === 'memo' ? 'text/plain' : 'application/vnd.google-apps.folder' }
    },
    listFiles: async () => ({ files: [{ id: 'memo' }, { id: 'shortcut', mimeType: 'application/vnd.google-apps.shortcut' }], nextPageToken: 'private-page-token' })
  })
  const session = { sub: 'ivy-sub' }
  const page = await gateway.list(session, 'admin-drive', admin)
  assert.deepEqual(page.files.map(f => f.name), ['Verified memo'])
  assert.equal(page.truncated, true)
  assert.equal(JSON.stringify(page).includes('private-page-token'), false)
  assert.equal(await gateway.referencesAllowed(session, [{ sourceId: 'admin-drive', fileId: 'memo' }]), true)
  revoked = true
  assert.equal(await gateway.referencesAllowed(session, [{ sourceId: 'admin-drive', fileId: 'memo' }]), false)
  await assert.rejects(gateway.list(session, 'admin-drive', admin))
})
