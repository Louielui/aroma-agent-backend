'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { t, currentLocale } = require('../../i18n/t')
const { registryView } = require('./registry')
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Release inventory, not a connection probe. Live source evidence stays in the
// briefing. Read the same planned-integration states used by the tool registry.
function buildArchitectureHtml () {
  const labels = {
    title: t('architecture.title'), intro: t('architecture.intro'), snapshot: t('architecture.snapshot', { date: '2026-09-29' }),
    back: t('manager.back'), briefing: t('manager.title'), component: t('architecture.component'),
    workbench: t('workerFlow.title'), connections: t('connections.title'),
    current: t('architecture.current'), next: t('architecture.next'), details: t('architecture.details'),
    foundation: t('architecture.foundation'), partial: t('architecture.partial'),
    pending_verification: t('architecture.pendingVerification'), statusGuide: t('architecture.statusGuide'),
    stage: t('architecture.stage'), later: t('architecture.later'), integrationScope: t('architecture.integrationScope'),
    not_connected: t('architecture.notConnected'), not_enabled: t('architecture.notEnabled'),
    unknown: t('manager.unknown'), integrations: t('architecture.integrations'),
    boundary: t('architecture.boundary'), boundaryText: t('architecture.boundaryText'),
    priority: t('architecture.priority'), priorityText: t('architecture.priorityText'),
    owner: t('architecture.owner'), core: t('architecture.core'), tools: t('architecture.tools'),
    result: t('architecture.result'), memory: t('architecture.memory'),
    flow: t('architecture.flow'), roles: t('architecture.roles'), rolesText: t('architecture.rolesText'),
    checklist: t('master.checklist'), capabilities: t('master.capabilities'), roadmap: t('master.roadmap'),
    layers: t('master.layers'), modules: t('master.modules'), scope: t('master.scope'), status: t('master.status'),
    worker: t('master.worker'), fallback: t('master.fallback'), routingNote: t('master.routingNote'),
    ownership: t('master.ownership'), memoryStack: t('master.memoryStack'), moduleNote: t('master.moduleNote'),
    timeline: t('master.timeline'), exclusions: t('master.exclusions'), exclusionsText: t('master.exclusionsText'),
    deferred: t('master.deferred'), deferredText: t('master.deferredText', { businessProfile: 'Google Business Profile' }), agentOrder: t('master.agentOrder')
  }
  const rows = [
    { id: 'brain', state: 'foundation', title: t('architecture.brainTitle'), purpose: t('architecture.brainPurpose'), component: t('architecture.brainComponent'), current: t('architecture.brainCurrent'), next: t('architecture.brainNext'), evidence: 'src/adapters/; src/subscription/' },
    { id: 'core', state: 'partial', title: t('architecture.coreTitle'), purpose: t('architecture.corePurpose'), component: t('architecture.coreComponent'), current: t('architecture.coreCurrent'), next: t('architecture.coreNext'), evidence: 'src/core/operating/registry.js; manager.js; gateway.js' },
    { id: 'tools', state: 'partial', title: t('architecture.toolsTitle'), purpose: t('architecture.toolsPurpose'), component: t('architecture.toolsComponent'), current: t('architecture.toolsCurrent'), next: t('architecture.toolsNext'), evidence: 'src/context/; src/agent/; src/computer/' },
    { id: 'workflow', state: 'partial', title: t('architecture.workflowTitle'), purpose: t('architecture.workflowPurpose'), component: t('architecture.workflowComponent'), current: t('architecture.workflowCurrent'), next: t('architecture.workflowNext'), evidence: 'src/core/operating/activityStore.js; src/store/; src/agent/' },
    { id: 'memory', state: 'partial', title: t('architecture.memoryTitle'), purpose: t('architecture.memoryPurpose'), component: t('architecture.memoryComponent', { component: 'Memory Gateway' }), current: t('architecture.memoryCurrent'), next: t('architecture.memoryNext'), evidence: 'src/memory/governed.js; runtime.js; structuredStore.js; scripts/memory/structured.py; docs/MEMORY-SIX-LAYERS.md' },
    { id: 'truth', state: 'foundation', title: t('architecture.truthTitle'), purpose: t('architecture.truthPurpose'), component: t('architecture.truthComponent'), current: t('architecture.truthCurrent'), next: t('architecture.truthNext'), evidence: 'src/context/adapters/aromaSystemRead.js' },
    { id: 'knowledge', state: 'foundation', title: t('architecture.knowledgeTitle'), purpose: t('architecture.knowledgePurpose'), component: t('architecture.knowledgeComponent'), current: t('architecture.knowledgeCurrent'), next: t('architecture.knowledgeNext'), evidence: 'src/context/; src/core/operating/registry.js' },
    { id: 'approval', state: 'partial', title: t('architecture.approvalTitle'), purpose: t('architecture.approvalPurpose'), component: t('architecture.approvalComponent'), current: t('architecture.approvalCurrent'), next: t('architecture.approvalNext'), evidence: 'src/governance/ownerAuth.js; src/agent/; src/core/operating/registry.js' }
  ]
  const cards = rows.map(row => `<article class="card" data-component="${escape(row.id)}" data-state="${escape(row.state)}">
    <div class="card-heading"><h2>${escape(row.title)}</h2><span class="badge ${escape(row.state)}">${escape(labels[row.state])}</span></div>
    <p class="purpose">${escape(row.purpose)}</p><dl><dt>${escape(labels.component)}</dt><dd>${escape(row.component)}</dd>
    <dt>${escape(labels.current)}</dt><dd>${escape(row.current)}</dd><dt>${escape(labels.next)}</dt><dd>${escape(row.next)}</dd></dl>
    <details><summary>${escape(labels.details)}</summary><code>${escape(row.evidence)}</code></details></article>`).join('\n')
  const integrationNames = { hindsight: 'Hindsight', memory_postgresql: t('architecture.memoryDatabase'), memory_pgvector: 'pgvector', qbo: 'QBO', '7shifts': '7shifts', business_write: t('architecture.businessWrite'),
    google_business: 'Google Business Profile', pos: 'POS', cloudflare: 'Cloudflare', make: 'Make', whatsapp: 'WhatsApp Business', sms: 'SMS',
    costco: 'Costco', wholesale_club: 'Wholesale Club', amazon: 'Amazon', supplier_portals: 'Supplier Portals', manus: 'Manus', grok: 'Grok' }
  const registered = registryView().integrations
  const stateOf = id => registered.find(item => item.id === id)?.state || 'unknown'
  const integrations = registered.map(item => `<tr data-integration="${escape(item.id)}"><th scope="row">${item.number ? escape(item.number) + ' · ' : ''}${escape(integrationNames[item.id] || item.id)}</th><td><span class="badge ${escape(item.state)}">${escape(labels[item.state] || labels.unknown)}</span></td><td>${item.phase != null ? 'Phase ' + escape(item.phase) : escape(labels.later)}</td></tr>`).join('')
  // The numbered inventory is a design/evidence snapshot, never a routable plan.
  const connections = [
    ['01', 'GitHub', 'pending_verification', t('master.github')],
    ['02', 'Google Drive', 'foundation', t('master.drive')],
    ['03', 'Aroma System API', 'foundation', t('master.aroma')],
    ['04', 'Google Calendar', 'foundation', t('master.calendar')],
    ['05', 'Gmail', 'foundation', t('master.gmail')],
    ['06', 'OpenAI / API', 'partial', t('master.openai')],
    ['07', 'Codex', 'partial', t('master.codex')],
    ['08', 'Claude / API', 'partial', t('master.claude')],
    ['09', 'Aroma Memory Gateway', 'partial', t('master.memoryGateway')],
    ['10', 'Hindsight', stateOf('hindsight'), t('master.hindsight')],
    ['11', 'PostgreSQL', stateOf('memory_postgresql'), t('master.postgres')],
    ['12', 'pgvector', stateOf('memory_pgvector'), t('master.pgvector')]
  ]
  const checklist = connections.map(([id, name, state, scope]) => `<tr data-connection="${id}" data-state="${escape(state)}"><th scope="row">${id} · ${escape(name)}</th><td><span class="badge ${escape(state)}">${escape(labels[state] || labels.unknown)}</span></td><td>${escape(scope)}</td></tr>`).join('')
  const optional = t('master.optional')
  const capabilities = [
    ['coding', 'Coding', 'Codex', 'Claude'], ['browser', 'Browser', 'Codex', 'Manus · ' + optional],
    ['computer', 'Computer Use', 'Codex', 'Manus · ' + optional], ['qa', 'System QA', 'Codex / Claude', 'Grok · ' + optional],
    ['architecture', 'Architecture', 'Claude', 'OpenAI'], ['reasoning', 'General Reasoning', 'OpenAI / Claude', t('master.otherModels')],
    ['research', 'Web Research', 'OpenAI', 'Grok · ' + optional], ['x-search', 'X Search · ' + optional, 'Grok · ' + optional, '—']
  ].map(([id, name, worker, fallback]) => `<tr data-capability="${id}"><th scope="row">${escape(name)}</th><td>${escape(worker)}</td><td>${escape(fallback)}</td></tr>`).join('')
  const phases = [t('master.phase0'), t('master.phase1'), t('master.phase2'), t('master.phase3'), t('master.phase4'), t('master.phase5'), t('master.phase6'), t('master.phase7'), t('master.phase8')]
    .map((text, id) => `<li data-phase="${id}"><strong>Phase ${id}</strong> · ${escape(text)}</li>`).join('')
  const modules = [t('master.capture'), t('master.context'), t('master.planner'), t('master.router'), t('master.dispatcher'), t('master.toolGateway'), t('master.memoryModule'), t('master.policy'), t('master.permission'), t('master.approval'), t('master.runTimeline'), t('master.audit'), t('master.briefing')]
    .map(text => `<li>${escape(text)}</li>`).join('')
  const replacements = { ...labels, lang: currentLocale() === 'en' ? 'en' : 'zh-Hant' }
  return fs.readFileSync(path.join(__dirname, 'architecture.html'), 'utf8')
    .replace(/\{\{(\w+)\}\}/g, (_, key) => escape(replacements[key]))
    .replace('<!--CARDS-->', () => cards).replace('<!--INTEGRATIONS-->', () => integrations)
    .replace('<!--CHECKLIST-->', () => checklist).replace('<!--CAPABILITIES-->', () => capabilities)
    .replace('<!--PHASES-->', () => phases).replace('<!--MODULES-->', () => modules)
}
module.exports = { buildArchitectureHtml }
