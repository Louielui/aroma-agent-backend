'use strict'
const { PROJECT, COVERAGE_RECIPE } = require('./contract')
const { localRequest } = require('../../adapters/CodexSubscriptionAdapter')
// Only the current Owner message chooses a registered task. History, retrieved
// documents and model output cannot select a project, file, command or approval.
function classify (message) {
  if (typeof message !== 'string' || message.length > 500) return null
  const s = message.trim().replace(/^(?:香香[，,：:\s]*|xiangxiang[, :]*)(?:幫我|請)?/i, '').trim()
  if (/^(?:請|幫我)?(?:修正|修復|改善)(?:香香(?:後端)?的?)?(?:LiveContext|ContextPack|即時資料|查詢)(?:的)?(?:查詢)?範圍(?:快照)?(?:會被來源修改|被來源改寫|互相影響|別名問題|快照問題)?[。.!！]?$/i.test(s.replace(/\s+/g, '')) || /^fix (?:xiangxiang )?(?:live context|context pack) (?:query )?scope (?:snapshot|aliasing)[.!]?$/i.test(s)) return { recipe: COVERAGE_RECIPE }
  if (/^(?:請|幫我)?(?:修正|修復|改善|開發)香香(?:後端)?(?:功能|程式)?[。.!！]?$/.test(s) || /^develop xiangxiang[.!]?$/i.test(s)) return { clarification: true }
  return null
}
function createChatWork ({ bootCommit, env = process.env, request = input => localRequest('/project-work', input, env) }) {
  return { async prepare (actor, input) {
    if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied')
    if (env.READ_ACCESS !== 'on') throw Error('not_enabled')
    if (!input || Object.keys(input).sort().join(',') !== 'message,requestId' || !/^[a-f0-9-]{36}$/.test(input.requestId || '') || classify(input.message)?.recipe !== COVERAGE_RECIPE) throw Error('invalid_request')
    const value = await request({ op: 'prepare', projectId: PROJECT, recipe: COVERAGE_RECIPE, requestId: input.requestId, bootCommit })
    if (value.error) throw Error(value.error)
    if (value.run?.workflow !== 'project_work' || value.run.workOrder?.recipe !== COVERAGE_RECIPE || value.run.requestId !== input.requestId) throw Error('invalid_worker_result')
    return value
  } }
}
module.exports = { classify, createChatWork }
