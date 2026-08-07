'use strict'
/**
 * probeRecallResults.js — LOOK AT THE PAGE BEFORE DESIGNING THE EXTRACTION.
 *
 * The house lesson: audit the real structure before writing the query. The old extractor
 * filtered by 「the query word appears in the title」, which silently dropped anything the site
 * considered relevant but titled differently — a false all-clear.
 *
 * This prints the raw shape so the replacement is designed from evidence: where the result
 * count lives, how a result is distinguishable from page furniture, and what order they come in.
 */
const { runRecallForIngredients } = require('../../src/errands/recallRunner')

// Reuse the runner's browser so the probe sees exactly what the errand sees.
const { chromium } = require('playwright-core')
const { launchOptions } = require('../../src/browser/launch')
const { readPage } = require('../../src/browser/axTree')
const { buildClick } = require('../../src/browser/click')
const { buildType } = require('../../src/browser/type')
const { buildWaitFor } = require('../../src/browser/wait')
const { buildSession } = require('../../src/browser/session')
const { buildRequestFence } = require('../../src/governance/requestFence')
const { HOST, SEARCH_PATH } = require('../../src/errands/recallCheck')

const QUERY = process.argv[2] || 'cheese'
const ORDER = { allowedOrigins: [HOST] }

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')
  const fence = buildRequestFence({ order: ORDER })
  await page.route('**/*', fence.handle)
  const s = buildSession({
    read: async () => { const { nodes } = await cdp.send('Accessibility.getFullAXTree'); return readPage(nodes, { maxNodes: 600, maxChars: 60000 }) },
    click: buildClick({ page, cdp, order: ORDER }),
    type: buildType({ page, cdp, order: ORDER }),
    waitFor: buildWaitFor({ page }),
    screenshot: async () => ({ outcome: 'CAPTURED' })
  })

  await page.goto(HOST + SEARCH_PATH, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await s.waitFor({ condition: 'network_idle', timeoutMs: 8000 })
  let v = await s.read()
  const box = v.nodes.find((n) => /searchbox|textbox|combobox/.test(n.role) && /search|recherche/i.test(n.name))
  await s.type({ ref: box.ref, domId: box.domId, expectRole: box.role, expectName: box.name, text: QUERY })
  v = await s.read()
  const go = v.nodes.find((n) => n.interactive && /^(search|go|submit|rechercher)$/i.test(n.name.trim())) ||
             v.nodes.find((n) => n.role === 'button' && /search/i.test(n.name))
  await s.click({ ref: go.ref, domId: go.domId, expectRole: go.role, expectName: go.name })
  await s.waitFor({ condition: 'network_idle', timeoutMs: 12000 })
  v = await s.read()

  console.log('\n===== QUERY: ' + QUERY + '  (' + v.nodes.length + ' nodes of ' + v.totalCandidates + ') =====\n')
  console.log('--- anything that looks like a COUNT ---')
  v.nodes.forEach((n, i) => {
    if (/\b\d+\b/.test(n.name) && /(result|résultat|found|of|about|показ|条|項)/i.test(n.name)) {
      console.log('  [' + i + '] ' + n.role + ' :: ' + n.name.replace(/\s+/g, ' ').slice(0, 120))
    }
  })
  console.log('\n--- first 45 nodes verbatim (order matters — this is the site ranking) ---')
  v.nodes.slice(0, 45).forEach((n, i) => {
    console.log('  [' + String(i).padStart(3) + '] ' + n.role.padEnd(12) + (n.interactive ? '*' : ' ') + ' ' + n.name.replace(/\s+/g, ' ').slice(0, 100))
  })

  await b.close()
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
