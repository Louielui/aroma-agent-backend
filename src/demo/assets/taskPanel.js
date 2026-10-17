'use strict'
// Existing Main task panel; UI transport only, no execution authority.
window.ImagineTaskPanel = function ({ el, t, addBot, addError, newConversation, getActive, isPending, msg, send, autoGrow }) {
  // Thin explicit transport into the shared bounded read intake. Viewing never
  // submits, merges histories or carries a browser grant into Main.
  var unifiedBusy = false
  async function showUnifiedTask(taskId, targetConversation) {
    if (!getActive() && !targetConversation) newConversation(false)
    var conv = targetConversation || getActive(), card = addBot(t('unified.scope'), conv)
    try {
      var response = await fetch('/api/v1/demo/task-intake/' + encodeURIComponent(taskId), { credentials: 'same-origin' })
      if (!response.ok) throw Error('unavailable')
      var task = await response.json(), box = card.body
      box.appendChild(el('p', '', task.objective)); box.appendChild(el('p', '', task.executionState + ' · ' + task.coverage + ' · ' + t('unified.unverified')))
      task.outcomes.forEach(function (o) { box.appendChild(el('p', '', o.ownerQuote + ' · ' + o.blockers.join(', '))) })
      if (task.result) box.appendChild(el('p', '', task.result))
      if (task.investigation) box.appendChild(el('p', '', t('unified.investigation') + ': ' + task.investigation.readState + ' · ' + task.investigation.sourceCoverage + ' · ' + task.investigation.answerCoverage + ' · ' + t('unified.unverified')))
      if (task.investigation && !task.investigation.goalVerifiedComplete) box.appendChild(el('p', '', t('unified.goalUnresolved')))
      if (task.executionState === 'WAITING_CLARIFICATION' && task.clarification && task.continuationEnabled) {
        task.clarification.candidates.forEach(function (c, index) { box.appendChild(el('p', '', String(index + 1) + '. ' + (c.label || t('unified.untitled')))) })
        var form = el('form'), input = el('input'), reply = el('button', 'ghost', t('unified.reply')), submitted = null
        input.type = 'text'; input.maxLength = 1000; input.setAttribute('aria-label', t('unified.clarification')); reply.type = 'submit'
        form.appendChild(input); form.appendChild(reply); box.appendChild(form)
        form.addEventListener('submit', async function (event) {
          event.preventDefault()
          if (unifiedBusy || !input.value.trim()) return
          if (!submitted || submitted.response !== input.value) submitted = { version: 1, operation: 'clarification_response', clientSubmissionId: crypto.randomUUID(), conversationId: conv.cid, taskRef: task.taskId, expectedRevision: task.revision, clarificationId: task.clarification.id, response: input.value }
          unifiedBusy = true; reply.disabled = true
          try {
            var response = await fetch('/api/v1/demo/task-intake', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submitted) })
            if (!response.ok && response.status !== 409) throw Error('unavailable')
            form.remove(); await showUnifiedTask(task.taskId, conv)
          } catch (_) { addError(t('unified.unavailable'), conv); reply.disabled = false } finally { unifiedBusy = false }
        })
      }
      if (task.active === true) {
        var stopTask = el('button', 'ghost', t('unified.cancel')); stopTask.type = 'button'
        stopTask.addEventListener('click', async function () {
          stopTask.disabled = true
          try {
            var response = await fetch('/api/v1/demo/task-intake/' + encodeURIComponent(task.taskId) + '/cancel', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: task.attemptId, expectedRevision: task.revision }) })
            if (!response.ok) throw Error('unavailable')
            showUnifiedTask(task.taskId, conv)
          } catch (_) { addError(t('unified.unavailable'), conv) }
        }); box.appendChild(stopTask)
      } else if (task.continuationEnabled) {
        var button = el('button', 'ghost', t('unified.continue')); button.type = 'button'
        button.addEventListener('click', function () { if (getActive() !== conv || isPending()) return; button.disabled = true; submitUnifiedTask(task.objective, conv, task) })
        box.appendChild(button)
      }
    } catch (_) { addError(t('unified.unavailable'), conv) }
  }
  async function submitUnifiedTask(message, conv, prior) {
    if (unifiedBusy) return
    unifiedBusy = true
    try {
      var response = await fetch('/api/v1/demo/task-intake', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, operation: prior ? 'continue' : 'start', clientSubmissionId: crypto.randomUUID(), message: message, conversationId: conv.cid, taskRef: prior ? prior.taskId : null, expectedRevision: prior ? prior.revision : null, contextRefs: [] }) })
      var result = await response.json()
      if (response.status === 409 && prior) await showUnifiedTask(prior.taskId, conv)
      if (!response.ok || !result.unifiedTask) throw Error('unavailable')
      if (result.historySaved === false) addError(t('unified.historyUnavailable'), conv)
      await showUnifiedTask(result.unifiedTask.taskId, conv)
    } catch (_) { addError(t('unified.unavailable'), conv) } finally { unifiedBusy = false }
  }
  if (document.getElementById('app').getAttribute('data-unified-task-intake') === 'true') {
    var startTask = el('button', 'ghost', t('unified.start')); startTask.type = 'button'
    startTask.addEventListener('click', function () { if (isPending() || unifiedBusy || !msg.value.trim()) return; var message = msg.value; if (!getActive()) newConversation(false); msg.value = message; autoGrow(); submitUnifiedTask(message, getActive(), null) })
    send.parentNode.appendChild(startTask)
  }


  return { show: showUnifiedTask }
}
