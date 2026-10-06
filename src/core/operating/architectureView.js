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
    title: t('architecture.title'), intro: t('architecture.intro'), snapshot: t('architecture.snapshot', { date: '2026-10-05' }),
    back: t('manager.back'), briefing: t('manager.title'), component: t('architecture.component'),
    workbench: t('workerFlow.title'), developmentPlan: t('plan.title'), connections: t('connections.title'), companyAccess: t('company.title'), liveContext: t('live.title'), driveContext: t('driveContext.title'), aromaContext: t('aromaContext.title'), calendarContext: t('calendarContext.title'), gmailContext: t('gmailContext.title'),
    current: t('architecture.current'), next: t('architecture.next'), details: t('architecture.details'),
    foundation: t('architecture.foundation'), partial: t('architecture.partial'), connected: t('architecture.connected'),
    pending_verification: t('architecture.pendingVerification'), statusGuide: t('architecture.statusGuide'),
    stage: t('architecture.stage'), later: t('architecture.later'), integrationScope: t('architecture.integrationScope'),
    not_connected: t('architecture.notConnected'), not_enabled: t('architecture.notEnabled'),
    unknown: t('manager.unknown'), integrations: t('architecture.integrations'),
    boundary: t('architecture.boundary'), boundaryText: t('architecture.boundaryText'),
    priority: t('architecture.priority'), priorityText: t('architecture.priorityText', { drive: 'Aroma Base', pack: 'Context Pack' }),
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
    { id: 'topic-workspaces', state: 'partial', title: t('topic.architectureTitle'), purpose: t('topic.intro'), component: 'Owner topic membership / durable chat history / revisioned manual follow-ups / source-ID-only email handoff', current: t('topic.current'), next: t('topic.limits'), evidence: 'src/topics/; src/demo/assets/topics.js; src/context/gmailContextView.html; docs/TOPIC-WORKSPACES-V1.md; /demo?topic=email; /api/v1/topic-workspaces' },
    { id: 'project-tasks', title: t('projectTask.title'), purpose: t('projectTask.intro'), component: 'Immutable task registry / closed Context and sidebar profiles / protected acceptance drafts / independent approvals / offline execution', state: 'partial', current: t('projectTask.current') + ' ' + t('dialogue.reviewChecks'), next: t('projectTask.next'), evidence: 'src/core/projectTasks/; src/core/workerFlow/providers.js; src/workers/execution/chatBrowser.cjs; docs/INTERFACE-TASKS-V1.md; docs/UI-REQUEST-FLOW.md; /project-tasks; /api/v1/project-tasks' },
    { id: 'task-planner', title: t('taskPlan.title'), purpose: t('taskPlan.boundary'), component: 'Bound conversation-to-job handoff / whole-request capability assessment / fixed committed profiles / verified quotes / subscription planning / actual-pixel review', state: 'partial', current: t('taskPlan.current') + ' ' + t('taskPlan.handoffCurrent') + ' ' + t('dialogue.requestFlow') + ' ' + t('uiDesign.current') + ' ' + require('../projectWork/resultLabels').resultLabels().resultArchitecture, next: t('taskPlan.next') + ' ' + t('dialogue.requestFlowLimits') + ' ' + t('uiDesign.limits'), evidence: 'src/core/taskPlanner/; src/design/; skills/xiangxiang-ui-design/; docs/UI-REQUEST-FLOW.md; docs/UI-DESIGN-V1.md; /demo; /api/v1/task-plan' },
    { id: 'project-adoption', state: 'partial', title: t('projectAdoption.title'), purpose: t('projectAdoption.intro'), component: 'Owner approval / whole-file-set source / offline retest / one local commit / verified reload / whole-set rollback / compact evidence views', current: t('projectAdoption.current'), next: t('projectAdoption.limits'), evidence: 'src/core/projectWork/adoption*.js; src/subscription/adoptionPayload.test.js; docs/PROJECT-MULTIFILE-V2.md; docs/UI-REQUEST-FLOW.md; /project-work' },
    { id: 'project-work', state: 'partial', title: t('projectWork.title'), purpose: t('projectWork.intro'), component: 'Registered backend file sets / chat task planning / separate one-use approvals / in-chat progress / Windows Sandbox / Sol 6.1 High / Claude / bounded visual correction', current: t('projectWork.current') + ' ' + t('uiDesign.repairChecks'), next: t('projectWork.limits') + ' ' + t('uiDesign.limits'), evidence: 'src/core/projectWork/; src/workers/execution/visualRepairFeedback.js; docs/CHAT-PROJECT-WORK-V1.md; docs/UI-REQUEST-FLOW.md; /demo; /project-work' },
    { id: 'worker-isolation', state: 'connected', title: t('isolation.title'), purpose: t('isolation.purpose'), component: 'Windows Sandbox / offline packaged workspace / text-only Codex / one-use approval', current: t('isolation.current'), next: t('isolation.next'), evidence: 'src/workers/execution/; docs/WORKER-ISOLATION-V1.md; /workers' },
    { id: 'code-repair', state: 'partial', title: t('repair.title'), purpose: t('repair.intro'), component: 'Capability Registry / Policy / single-use Owner approval / Codex / fixed repair catalogue', current: t('repair.adoptionCurrent'), next: t('repair.limits'), evidence: 'src/core/codeRepair/; docs/CONTROLLED-REPAIR-V1.md; docs/CONTROLLED-REPAIR-ADOPTION-V1.md' },
    { id: 'development-plan', state: 'partial', title: t('architecture.planTitle'), purpose: t('architecture.planPurpose'), component: 'Capability Registry / Policy / Dispatcher / Codex subscription', current: t('architecture.planCurrent'), next: t('architecture.planNext'), evidence: 'src/core/developmentPlan/; src/core/codeDiagnosis/; src/capability/requestRouter.js; docs/CONTROLLED-DISPATCH-V1.md' },
    { id: 'mail-memory', state: 'partial', title: t('architecture.mailMemoryTitle'), purpose: t('architecture.mailMemoryPurpose'), component: 'PostgreSQL / Gmail / Hindsight / Claude subscription', current: t('architecture.mailMemoryCurrent'), next: t('architecture.mailMemoryNext'), evidence: 'src/company/mailMemory.js; mailSemantic.js; mailHistory.js; mailChat.test.js; docs/MEMORY-RECOVERY.md; docs/ADMIN-MAIL-NOTIFICATIONS.md' },
    { id: 'chat-images', state: 'partial', title: t('imageChat.title'), purpose: t('imageChat.uploadNote'), component: 'Clipboard/file preview / bounded normalized PNG / selected subscription vision / protected conversation history', current: t('imageChat.current'), next: t('imageChat.limits'), evidence: 'docs/CHAT-IMAGES-V1.md; src/chat/; src/routes/imageChat.test.js; src/subscription/chatImages.test.js (service, adapter and bridge contract); /demo; /api/v1/demo/image-intake' },
    { id: 'brain', state: 'foundation', title: t('architecture.brainTitle'), purpose: t('architecture.brainPurpose'), component: t('architecture.brainComponent'), current: t('architecture.brainCurrent'), next: t('architecture.brainNext'), evidence: 'src/adapters/; src/subscription/claudeBrain.test.js; docs/CLAUDE-BRAIN.md' },
    { id: 'core', state: 'partial', title: t('architecture.coreTitle'), purpose: t('architecture.corePurpose'), component: t('architecture.coreComponent'), current: t('architecture.coreCurrent'), next: t('architecture.coreNext'), evidence: 'src/core/operating/registry.js; manager.js; gateway.js' },
    { id: 'tools', state: 'partial', title: t('architecture.toolsTitle'), purpose: t('architecture.toolsPurpose'), component: t('architecture.toolsComponent'), current: t('architecture.toolsCurrent', { drive: 'Aroma Base', pack: 'Knowledge Context Pack', truthPack: 'Truth Context Pack' }), next: t('architecture.toolsNext'), evidence: 'src/context/; src/agent/; src/computer/' },
    { id: 'workflow', state: 'partial', title: t('architecture.workflowTitle'), purpose: t('architecture.workflowPurpose'), component: t('architecture.workflowComponent'), current: t('architecture.workflowCurrent'), next: t('architecture.workflowNext'), evidence: 'src/core/operating/activityStore.js; src/store/; src/agent/' },
    { id: 'memory', state: 'partial', title: t('architecture.memoryTitle'), purpose: t('architecture.memoryPurpose'), component: t('architecture.memoryComponent', { component: 'Memory Gateway' }), current: t('architecture.memoryCurrent'), next: t('architecture.memoryNext'), evidence: 'src/memory/governed.js; runtime.js; operations.js; backupScheduler.js; scripts/memory/serviceSupervisor.cjs; docs/MEMORY-SIX-LAYERS.md; docs/MEMORY-OWNER-V1-ACCEPTANCE.md' },
    { id: 'truth', state: 'partial', title: t('architecture.truthTitle'), purpose: t('architecture.truthPurpose'), component: t('architecture.truthComponent'), current: t('architecture.truthCurrent', { pack: 'Truth Context Pack' }), next: t('architecture.truthNext'), evidence: 'src/context/adapters/aromaSystemRead.js; src/context/aromaContext.js; src/context/aromaContextService.js; docs/AROMA-LIVE-CONTEXT-V1.md' },
    { id: 'knowledge', state: 'partial', title: t('architecture.knowledgeTitle'), purpose: t('architecture.knowledgePurpose'), component: t('architecture.knowledgeComponent'), current: t('architecture.knowledgeCurrent', { drive: 'Aroma Base', pack: 'Knowledge Context Pack' }), next: t('architecture.knowledgeNext'), evidence: 'src/context/driveContext.js; src/context/driveScope.js; src/context/toolGateway.js' },
    { id: 'approval', state: 'partial', title: t('architecture.approvalTitle'), purpose: t('architecture.approvalPurpose'), component: t('architecture.approvalComponent'), current: t('architecture.approvalCurrent'), next: t('architecture.approvalNext'), evidence: 'src/governance/ownerAuth.js; src/company/; docs/COMPANY-ACCESS.md' }
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
    ['01', 'GitHub', 'partial', t('master.github')],
    ['02', 'Google Drive', 'partial', t('master.drive', { drive: 'Aroma Base' })],
    ['03', 'Aroma System API', 'partial', t('master.aroma')],
    ['04', 'Google Calendar', 'partial', t('master.calendar')],
    ['05', 'Gmail', 'partial', t('master.gmail')],
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
  labels.codeDiagnosis = t('work.title')
  labels.codeRepair = t('repair.title')
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
