'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { hasBrowserAuthority } = require('./browserAuthority')
const { browserCatalogueSource } = require('../../src/i18n/browserResolver')

test('browser authority scan distinguishes compiled labels from credentials and header code', () => {
  const catalogue = browserCatalogueSource()
  assert.match(catalogue, /authorization/i)
  assert.equal(hasBrowserAuthority(catalogue), false)
  for (const code of ["fetch('/', { headers: { Authorization: secret } })", "headers['Authorization'] = secret", 'HUB_TOKEN', 'Bearer fixture-token']) {
    assert.equal(hasBrowserAuthority(catalogue + '\n' + code), true, code)
  }
  assert.equal(hasBrowserAuthority(catalogue.replace('tool authorization', 'Bearer fixture-token')), true)
  assert.equal(hasBrowserAuthority(catalogue.replace('tool authorization', 'HUB_TOKEN')), true)
  assert.equal(hasBrowserAuthority(catalogue.replace('tool authorization', 'Authorization: injected')), true)
})
