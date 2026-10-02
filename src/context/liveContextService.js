'use strict'
const path = require('node:path')
const { createReadConnector } = require('./readConnector')
const { createToolGateway } = require('./toolGateway')
const { createActivityStore } = require('../core/operating/activityStore')
const { createDevelopmentContext } = require('./developmentContext')
const { createGithubContextAdapter, githubResources, REPOSITORY } = require('./githubContext')
const { createDriveContextAdapter, driveResources } = require('./driveContext')
const { createOwnerDriveScope, ID } = require('./driveScope')
const { createDriveContextService } = require('./driveContextService')
function createRuntimeLiveContext ({ env = process.env, runtime, registry }) {
  const connector = createReadConnector({ env, caps: { timeoutMs: 10000, maxResults: 25 } })
  const repository = REPOSITORY.test(env.GITHUB_READ_REPO || '') ? env.GITHUB_READ_REPO : null
  const resources = repository ? githubResources(repository) : []
  if (repository) connector.register(createGithubContextAdapter({ repository }))
  const scope = createOwnerDriveScope({ registry, env }), source = scope.source()
  if (source?.state === 'registered' && ID.test(source.rootId || '') && source.rootId === source.driveId) {
    connector.register(createDriveContextAdapter({ scope })); resources.push(...driveResources(source))
  }
  const dir = path.join(require('../store/dataDir').resolveDataDir(), 'context-activity')
  const aromaAccess = require('./aromaContext').createAromaContextAccess(env)
  connector.register(require('./aromaContext').createAromaContextAdapter({ env, verify: aromaAccess }))
  resources.push(...require('./aromaContext').aromaResources())
  const calendarScope = require('./calendarContext').createOwnerCalendarScope({ registry, env })
  connector.register(require('./calendarContext').createCalendarContextAdapter({ scope: calendarScope }))
  resources.push(...require('./calendarContext').calendarResources())
  const gmailScope = require('./gmailContext').createGmailScope({ registry, env })
  connector.register(require('./gmailContext').createGmailContextAdapter({ scope: gmailScope }))
  resources.push(...require('./gmailContext').gmailResources())
  const githubAudit = createActivityStore({ dir, workflow: 'development_context', reason: 'owner_requested_context' })
  const driveAudit = createActivityStore({ dir, workflow: 'drive_context', reason: 'owner_requested_context' })
  const aromaAudit = createActivityStore({ dir, workflow: 'aroma_context', reason: 'owner_requested_context' })
  const calendarAudit = createActivityStore({ dir, workflow: 'calendar_context', reason: 'owner_requested_context' })
  const gmailAudit = createActivityStore({ dir, workflow: 'gmail_context', reason: 'owner_requested_context' })
  const gateway = createToolGateway({ connector, resources, audit: { append: e => (e.source === 'gmail' ? gmailAudit : e.source === 'calendar' ? calendarAudit : e.source === 'aroma_system' ? aromaAudit : e.source === 'drive' ? driveAudit : githubAudit).append(e) } })
  const development = createDevelopmentContext({ gateway, repository, runtime, enabled: () => require('./flags').readAccessEnabled(env, 'github') })
  return Object.freeze({ ...development, drive: createDriveContextService({ gateway, scope }), aroma: require('./aromaContextService').createAromaContextService({ gateway, verify: aromaAccess }),
    calendar: require('./calendarContextService').createCalendarContextService({ gateway, scope: calendarScope }), gmail: require('./gmailContextService').createGmailContextService({ gateway, scope: gmailScope }), activity: () => githubAudit.list() })
}
module.exports = { createRuntimeLiveContext }
