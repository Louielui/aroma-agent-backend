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
    current: t('architecture.current'), next: t('architecture.next'), details: t('architecture.details'),
    foundation: t('architecture.foundation'), partial: t('architecture.partial'),
    not_connected: t('architecture.notConnected'), not_enabled: t('architecture.notEnabled'),
    unknown: t('manager.unknown'), integrations: t('architecture.integrations'),
    boundary: t('architecture.boundary'), boundaryText: t('architecture.boundaryText'),
    priority: t('architecture.priority'), priorityText: t('architecture.priorityText'),
    owner: t('architecture.owner'), core: t('architecture.core'), tools: t('architecture.tools'),
    result: t('architecture.result'), memory: t('architecture.memory'),
    flow: t('architecture.flow'), roles: t('architecture.roles'), rolesText: t('architecture.rolesText')
  }
  const rows = [
    { id: 'brain', state: 'foundation', title: t('architecture.brainTitle'), purpose: t('architecture.brainPurpose'), component: t('architecture.brainComponent'), current: t('architecture.brainCurrent'), next: t('architecture.brainNext'), evidence: 'src/adapters/; src/subscription/' },
    { id: 'core', state: 'partial', title: t('architecture.coreTitle'), purpose: t('architecture.corePurpose'), component: t('architecture.coreComponent'), current: t('architecture.coreCurrent'), next: t('architecture.coreNext'), evidence: 'src/core/operating/registry.js; manager.js; gateway.js' },
    { id: 'tools', state: 'partial', title: t('architecture.toolsTitle'), purpose: t('architecture.toolsPurpose'), component: t('architecture.toolsComponent'), current: t('architecture.toolsCurrent'), next: t('architecture.toolsNext'), evidence: 'src/context/; src/agent/; src/computer/' },
    { id: 'workflow', state: 'partial', title: t('architecture.workflowTitle'), purpose: t('architecture.workflowPurpose'), component: t('architecture.workflowComponent'), current: t('architecture.workflowCurrent'), next: t('architecture.workflowNext'), evidence: 'src/core/operating/activityStore.js; src/store/; src/agent/' },
    { id: 'memory', state: 'partial', title: t('architecture.memoryTitle'), purpose: t('architecture.memoryPurpose'), component: t('architecture.memoryComponent', { component: 'Memory Gateway' }), current: t('architecture.memoryCurrent'), next: t('architecture.memoryNext'), evidence: 'src/core/operating/gateway.js; registry.js' },
    { id: 'truth', state: 'foundation', title: t('architecture.truthTitle'), purpose: t('architecture.truthPurpose'), component: t('architecture.truthComponent'), current: t('architecture.truthCurrent'), next: t('architecture.truthNext'), evidence: 'src/context/adapters/aromaSystemRead.js' },
    { id: 'knowledge', state: 'foundation', title: t('architecture.knowledgeTitle'), purpose: t('architecture.knowledgePurpose'), component: t('architecture.knowledgeComponent'), current: t('architecture.knowledgeCurrent'), next: t('architecture.knowledgeNext'), evidence: 'src/context/; src/core/operating/registry.js' },
    { id: 'approval', state: 'partial', title: t('architecture.approvalTitle'), purpose: t('architecture.approvalPurpose'), component: t('architecture.approvalComponent'), current: t('architecture.approvalCurrent'), next: t('architecture.approvalNext'), evidence: 'src/governance/ownerAuth.js; src/agent/; src/core/operating/registry.js' }
  ]
  const cards = rows.map(row => `<article class="card" data-component="${escape(row.id)}" data-state="${escape(row.state)}">
    <div class="card-heading"><h2>${escape(row.title)}</h2><span class="badge ${escape(row.state)}">${escape(labels[row.state])}</span></div>
    <p class="purpose">${escape(row.purpose)}</p><dl><dt>${escape(labels.component)}</dt><dd>${escape(row.component)}</dd>
    <dt>${escape(labels.current)}</dt><dd>${escape(row.current)}</dd><dt>${escape(labels.next)}</dt><dd>${escape(row.next)}</dd></dl>
    <details><summary>${escape(labels.details)}</summary><code>${escape(row.evidence)}</code></details></article>`).join('\n')
  const integrationNames = { hindsight: 'Hindsight', memory_postgresql: t('architecture.memoryDatabase'), qbo: 'QBO', '7shifts': '7shifts', business_write: t('architecture.businessWrite') }
  const integrations = registryView().integrations.map(item => `<li><strong>${escape(integrationNames[item.id] || item.id)}</strong> — ${escape(labels[item.state] || labels.unknown)}</li>`).join('')
  const replacements = { ...labels, lang: currentLocale() === 'en' ? 'en' : 'zh-Hant' }
  return fs.readFileSync(path.join(__dirname, 'architecture.html'), 'utf8')
    .replace(/\{\{(\w+)\}\}/g, (_, key) => escape(replacements[key]))
    .replace('<!--CARDS-->', () => cards).replace('<!--INTEGRATIONS-->', () => integrations)
}
module.exports = { buildArchitectureHtml }
