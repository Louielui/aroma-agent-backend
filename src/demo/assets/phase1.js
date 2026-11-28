
;(function (root) {
  'use strict'
  var keys = ['B', 'P']
  var valid = function (id) { return keys.indexOf(id) >= 0 }
  var fresh = function () { return { draft: '', turns: [] } }
  function mount (doc, labels, handoff) {
    if (root.location.protocol !== 'http:' || root.location.hostname !== '127.0.0.1') return
    var prefix = '/api/v1/demo/experimental/'
    function get () {
      return root.fetch(prefix + 'status', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
        .then(function (res) { return res.ok ? res.json() : null })
    }
    function request (route, body) {
      if (!['selection', 'chat', 'release'].includes(route)) return Promise.reject(Error('experiment_input_invalid'))
      return root.fetch(prefix + route, {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(async function (res) {
        var value = await res.json().catch(function () { return {} })
        if (!res.ok) throw Error(value.error || 'experiment_unavailable')
        return value
      })
    }
    function ready (catalog) {
      return catalog && catalog.enabled === true && catalog.profiles && keys.every(function (id) {
        var row = catalog.profiles[id]
        return row && row.profile === id && typeof row.model === 'string' && typeof row.engine === 'string' && row.architecture === 'B'
      }) && (catalog.selected === 'default' || valid(catalog.selected)) && Number.isInteger(catalog.revision)
    }
    get().then(function (catalog) {
      if (!ready(catalog)) return
      function element (tag, cls, text) {
        var node = doc.createElement(tag)
        if (cls) node.className = cls
        if (text !== undefined) node.textContent = text
        return node
      }
      var main = doc.getElementById('main'), sidebar = doc.getElementById('sidebar')
      var picker = element('select', 'phase1-model-picker')
      var panel = element('section', 'phase1-panel')
      var log = element('div', 'phase1-log')
      var form = element('form', 'phase1-form'), draft = element('textarea')
      var actions = element('div', 'phase1-actions'), feedback = element('p', 'phase1-status')
      var submit = element('button', '', labels.send)
      var release = element('button', '', labels.release)
      var reset = element('button', '', labels.reset)
      var names = { default: labels.original, B: labels.flash, P: labels.alternate }
      var phasePending = false, current = 'default'
      var lastCheckpoint = 0, checkpointTimer = null
      var threads = { B: fresh(), P: fresh() }
      var resume = handoff.take()
      if (resume && keys.every(function (key) {
        var thread = resume[key]
        return thread && typeof thread.draft === 'string' && thread.draft.length <= 16000 &&
          Array.isArray(thread.turns) && thread.turns.length <= 19 &&
          thread.turns.every(function (pair) {
            return pair && typeof pair.user === 'string' && pair.user.length <= 16000 &&
              typeof pair.reply === 'string' && pair.reply.length <= 16000
          })
      })) threads = { B: resume.B, P: resume.P }
      picker.id = 'phase1-model-picker'
      picker.setAttribute('aria-label', labels.picker)
      Object.keys(names).forEach(function (key) {
        var option = element('option', '', names[key])
        option.value = key
        picker.appendChild(option)
      })
      doc.getElementById('topbar').appendChild(picker)
      panel.hidden = true
      panel.setAttribute('aria-label', labels.panel)
      log.setAttribute('role', 'log')
      log.setAttribute('aria-label', labels.messages)
      draft.id = 'phase1-draft'
      draft.rows = 3
      draft.maxLength = 16000
      draft.setAttribute('aria-label', labels.input)
      submit.type = 'submit'
      release.type = reset.type = 'button'
      feedback.setAttribute('role', 'status')
      actions.append(submit, release, reset)
      form.append(draft, actions, feedback)
      panel.append(log, form)
      main.appendChild(panel)

      function paint () {
        var identity = catalog.profiles[current]
        log.replaceChildren()
        threads[current].turns.forEach(function (pair) {
          var answer = element('article', 'phase1-assistant')
          answer.append(element('div', 'phase1-reply', pair.reply),
            element('small', 'phase1-attribution', labels.identity(identity)))
          log.append(element('article', 'phase1-user', pair.user), answer)
        })
        log.scrollTop = log.scrollHeight
      }
      function show (id) {
        current = picker.value = id
        var active = valid(id)
        main.classList.toggle('phase1-active', active)
        sidebar.inert = active
        panel.hidden = !active
        if (!active) return
        paint()
        draft.value = threads[id].draft
        feedback.textContent = catalog.ready ? '' : labels.offline
      }
      function setPhasePending (value) {
        phasePending = value
        picker.disabled = submit.disabled = release.disabled = reset.disabled = draft.disabled = value
      }
      function errorText (error) {
        return /^experiment_[a-z_]{1,55}$/.test(error.message) ? error.message : 'experiment_unavailable'
      }
      function visibleNotice () {
        return valid(current) ? feedback : doc.getElementById('client-update-status')
      }
      picker.addEventListener('change', async function () {
        var desired = picker.value
        picker.value = current
        if (phasePending || handoff.busy() || desired === current || !Object.hasOwn(names, desired)) return
        setPhasePending(true)
        try {
          var committed = await request('selection', { selected: desired, revision: catalog.revision })
          if (committed.selected !== desired || committed.revision !== catalog.revision + 1) throw Error('experiment_receipt_mismatch')
          Object.assign(catalog, committed)
          show(desired)
          if (!valid(desired)) handoff.forgetFormal()
          checkpoint()
        } catch (error) {
          visibleNotice().textContent = labels.selectionFailed(errorText(error))
        } finally { setPhasePending(false) }
      })
      function checkpoint () {
        if (checkpointTimer !== null) root.clearTimeout(checkpointTimer)
        checkpointTimer = null
        lastCheckpoint = Date.now()
        if (valid(current)) handoff.preserveFormal()
        handoff.save(threads)
      }
      root.addEventListener('beforeunload', checkpoint)
      root.addEventListener('pagehide', checkpoint)
      draft.addEventListener('input', function () {
        if (!valid(current)) return
        var firstEdit = threads[current].draft === ''
        threads[current].draft = draft.value
        var elapsed = Date.now() - lastCheckpoint
        if (firstEdit || elapsed >= 350) checkpoint()
        else if (checkpointTimer === null) checkpointTimer = root.setTimeout(checkpoint, 350 - elapsed)
      })
      draft.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.repeat) {
          event.preventDefault()
          form.requestSubmit()
        }
      })
      form.addEventListener('submit', async function (event) {
        event.preventDefault()
        var id = current
        if (!valid(id) || phasePending || !draft.value.trim()) return
        var thread = threads[id]
        if (thread.turns.length >= 19) { feedback.textContent = labels.capacity; return }
        var message = draft.value
        var history = thread.turns.flatMap(function (pair) {
          return [{ role: 'user', content: pair.user }, { role: 'assistant', content: pair.reply }]
        })
        setPhasePending(true)
        feedback.textContent = labels.wait(names[id])
        try {
          var result = await request('chat', { profile: id, message: message, history: history })
          var expected = catalog.profiles[id]
          if (result.profile !== id || result.model !== expected.model || result.engine !== expected.engine ||
              result.architecture !== expected.architecture || result.calls !== 1 || typeof result.text !== 'string') {
            throw Error('experiment_model_mismatch')
          }
          thread.turns.push({ user: message, reply: result.text })
          draft.value = thread.draft = ''
          paint()
          checkpoint()
          feedback.textContent = ''
        } catch (error) {
          feedback.textContent = labels.chatFailed(errorText(error))
        } finally { setPhasePending(false) }
      })
      release.addEventListener('click', async function () {
        if (phasePending) return
        setPhasePending(true)
        try {
          var result = await request('release', {})
          if (result.state !== 'unloaded') throw Error('experiment_release_failed')
          feedback.textContent = labels.released
        } catch (error) {
          feedback.textContent = labels.releaseFailed(errorText(error))
        } finally { setPhasePending(false) }
      })
      reset.addEventListener('click', function () {
        if (phasePending || !valid(current)) return
        threads[current] = fresh()
        draft.value = feedback.textContent = ''
        paint()
        checkpoint()
      })
      show(catalog.selected)
    }).catch(function () {})
  }
  if (root) root.XiangxiangPhase1 = { mount: mount }
})(typeof window === 'object' ? window : null)
