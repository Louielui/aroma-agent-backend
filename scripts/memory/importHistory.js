'use strict'
// One-way idempotent import. Missing historical approval is never invented.
const fs = require('node:fs'); const path = require('node:path')
const { createGateway, OWNER, stableId } = require('../../src/memory/governed')
const { createStructuredStore } = require('../../src/memory/structuredStore')
async function importHistory({ dir, gateway, conversations, decisions = [] }) {
  const counts = { conversations: 0, decisions: 0, capture: 0, ignored: 0 }
  const ingest = async input => { const row = await gateway.observe(OWNER, input); if (row.status === 'ignored') counts.ignored++; return row }
  for (const summary of conversations.list()) {
    const c = conversations.get(summary.id)
    for (const [index, m] of c.messages.entries()) {
      if (typeof m.content !== 'string' || !m.content.trim()) continue
      await ingest({ id: stableId('history:' + c.id + ':' + index), type: 'episodic', subject: c.title || 'Historical conversation', text: m.content, scope: 'private:owner', policy: 'owner_history',
        source: { kind: 'historical_import', id: c.id + ':' + index, at: m.ts || null, attribution: m.role === 'user' ? 'owner_statement' : 'assistant_claim' } })
      counts.conversations++
    }
  }
  for (const r of decisions) {
    if (typeof r.statement !== 'string' || !r.statement.trim()) continue
    await ingest({ id: stableId('legacy-decision:' + r.id), type: 'decision', subject: r.statement.slice(0, 240), text: r.statement + (r.rationale ? '\n' + r.rationale : ''), scope: 'private:owner',
      source: { kind: 'legacy_decision', id: String(r.id), at: r.provenance?.decided_at || null, attribution: 'historical_import' },
      details: { originalApproval: r.provenance?.approved_by || null, importedAsCandidate: true } })
    counts.decisions++
  }
  const captureDir = path.join(dir, 'memory-capture')
  if (fs.existsSync(captureDir)) for (const f of fs.readdirSync(captureDir).filter(f => /^xx-[a-f0-9-]+\.json$/.test(f))) {
    const r = JSON.parse(fs.readFileSync(path.join(captureDir, f), 'utf8'))
    if (!r.text || ['skipped', 'forgotten', 'edited'].includes(r.state)) continue
    await ingest({ id: r.id, type: 'episodic', subject: r.source.kind + ' · ' + r.source.id, text: r.text, scope: 'private:owner', policy: 'owner_history',
      source: { kind: 'historical_import', id: r.source.id + ':' + (r.source.turn || ''), at: r.source.at || null, attribution: r.source.kind === 'briefing' ? 'measured_result' : 'historical_import' } })
    counts.capture++
  }
  return counts
}
async function main() {
  const repo = 'C:/Aroma/aroma-agent-backend'
  const env = require('dotenv').parse(fs.readFileSync(path.join(repo, '.env')))
  const dir = env.AROMA_DATA_DIR || path.join(repo, 'data')
  if (!path.isAbsolute(dir)) throw Error('absolute_data_directory_required')
  const conversations = require('../../src/store/conversationStore').createConversationStore({ dataDir: dir })
  const truthPath = path.join(dir, 'aroma-truth.json')
  const decisions = fs.existsSync(truthPath) ? JSON.parse(fs.readFileSync(truthPath, 'utf8')).decisions : []
  console.log(JSON.stringify(await importHistory({ dir, gateway: createGateway({ store: createStructuredStore({ local: true }), engine: null }), conversations, decisions })))
}
if (require.main === module) main().catch(() => { console.error('Historical import unconfirmed; sources were not changed.'); process.exitCode = 1 })
module.exports = { importHistory }
