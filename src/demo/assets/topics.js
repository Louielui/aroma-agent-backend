/* Owner topic workspaces. External source text remains data; this controller grants no execution authority. */
;(function (root) {
  'use strict'
  var TOPICS = {
    hr: ['open-hr', null], purchasing: ['open-purchasing', null], accounting: ['open-accounting', null], marketing: ['open-marketing', null],
    briefing: ['open-manager', '/manager'], documents: ['open-drive-context', '/drive-context'], operations: ['open-aroma-context', '/aroma-context'],
    calendar: ['open-calendar-context', '/calendar-context'], email: ['open-gmail-context', '/gmail-context'], development: ['open-live-context', '/live-context'],
    plans: ['open-development-plan', '/development-plan'], tasks: ['open-project-tasks', '/project-tasks'], workers: ['open-workers', '/workers'],
    memory: ['open-memory', '/memory'], connections: ['open-connections', '/connections'], access: ['open-company-access', '/company-access'], architecture: ['open-architecture', '/architecture']
  }
  function mount (doc, t, onDiscuss) {
    var topic = new URLSearchParams(root.location.search).get('topic')
    if (!Object.hasOwn(TOPICS, topic)) topic = null
    Object.keys(TOPICS).forEach(function (key) {
      var button = doc.getElementById(TOPICS[key][0])
      if (button) button.addEventListener('click', function (event) { event.stopImmediatePropagation(); root.location.href = '/demo?topic=' + key }, true)
    })
    if (!topic) return null
    var n = function (tag, text, cls) { var node = doc.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node }
    var main = doc.getElementById('main'), box = n('section', null, 'topic-workspace'), heading = n('div', null, 'topic-heading')
    box.id = 'topic-workspace'; box.dataset.topic = topic; main.classList.add('topic-mode'); main.insertBefore(box, doc.getElementById('log'))
    var home = doc.getElementById('open-home')
    if (home) home.addEventListener('click', function (event) { event.stopImmediatePropagation(); root.location.href = '/demo' }, true)
    var status = n('p', '', 'topic-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    var topicName = function () { var b = doc.getElementById(TOPICS[topic][0]); return b ? b.textContent.trim() : topic }
    var title = n('h2'), subtitle = n('p'), tools = n('details', null, 'topic-tools'), toolSummary = n('summary'), toolOpen = n('a')
    heading.append(title, subtitle); box.append(heading, status, tools); tools.append(toolSummary, toolOpen)
    var toolPath = TOPICS[topic][1]
    if (toolPath) { toolOpen.href = toolPath; toolOpen.target = '_blank'; toolOpen.rel = 'noopener'; toolOpen.className = 'topic-original' }
    else tools.remove()
    var frame = null
    tools.addEventListener('toggle', function () { if (toolPath && tools.open && !frame) { frame = n('iframe'); frame.src = toolPath; frame.title = topicName(); frame.className = 'topic-tool-frame'; tools.append(frame) } })
    var hrForm = null, hrDateLabel, hrDate, hrPrepare, hrMissing, hrCompare, hrTitle, hrHint, hrFuture, hrTools, hrSummary
    if (topic === 'hr') {
      box.classList.add('department-compact')
      subtitle.remove()
      hrTools = n('details', null, 'department-tools'); hrTools.id = 'hr-tools'; hrSummary = n('summary'); hrTools.append(hrSummary); box.append(hrTools)
      var attendance = n('section', null, 'department-attendance')
      hrTitle = n('h3'); hrHint = n('p'); hrFuture = n('p', null, 'department-planned'); hrForm = n('form', null, 'department-query')
      hrDateLabel = n('label'); hrDate = n('input'); hrDate.id = 'hr-query-date'; hrDate.type = 'date'; hrDate.required = true
      hrDateLabel.append(n('span'), hrDate); hrPrepare = n('button'); hrPrepare.id = 'hr-query-prepare'; hrPrepare.type = 'submit'
      hrMissing = n('button'); hrMissing.id = 'hr-missing-prepare'; hrMissing.type = 'button'
      hrCompare = n('button'); hrCompare.id = 'hr-compare-prepare'; hrCompare.type = 'button'
      hrForm.append(hrDateLabel, hrPrepare, hrMissing, hrCompare); attendance.append(hrTitle, hrHint, hrForm, hrFuture); hrTools.append(attendance)
      function prepareAttendance (missing) {
        var date = hrDate.value
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) { status.textContent = t('department.dateRequired'); return }
        var message = missing === 'compare' ? t('department.comparisonRequest', { date: date }) : missing ? t('department.missingRequest', { date: date }) : t('department.clockOutRequest', { date: date })
        status.textContent = onDiscuss(message) === false ? t('topic.draftBusy') : t('department.queryPrepared')
      }
      hrForm.addEventListener('submit', function (event) { event.preventDefault(); prepareAttendance(false) })
      hrMissing.addEventListener('click', function () { prepareAttendance(true) })
      hrCompare.addEventListener('click', function () { prepareAttendance('compare') })
    }
    var tracking = n('details', null, 'topic-tracking'), trackingSummary = n('summary'), notes = n('div'), form = n('form', null, 'topic-note-form')
    tracking.id = 'topic-follow-ups'; tracking.append(trackingSummary, notes, form); box.append(tracking)
    if (hrTools) {
      var trackingPanel = n('div', null, 'department-tracking-panel'); trackingPanel.append(notes, form); tracking.append(trackingPanel)
      ;[hrTools, tracking].forEach(function (panel) {
        panel.addEventListener('toggle', function () { if (panel.open) (panel === hrTools ? tracking : hrTools).open = false })
      })
      doc.addEventListener('click', function (event) { if (!box.contains(event.target)) { hrTools.open = false; tracking.open = false } })
      box.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return
        var panel = hrTools.open ? hrTools : tracking.open ? tracking : null
        if (panel) { panel.open = false; panel.querySelector('summary').focus(); event.stopPropagation() }
      })
    }
    var titleLabel = n('label'), nextLabel = n('label'), titleInput = n('input'), nextInput = n('input'), add = n('button'), sourceHint = n('p', '', 'topic-source')
    titleInput.id = 'topic-note-title'; titleInput.maxLength = 160; titleInput.required = true; nextInput.id = 'topic-note-next'; nextInput.maxLength = 600
    titleLabel.append(titleInput); nextLabel.append(nextInput); add.type = 'submit'; form.append(titleLabel, nextLabel, sourceHint, add)
    var data = null, source = null, requestId = root.crypto.randomUUID(), inflight = false
    function labels () {
      var department = ['hr', 'purchasing', 'operations', 'accounting', 'marketing'].includes(topic)
      title.textContent = department ? t('department.workspace', { name: topicName() }) : t('topic.title', { name: topicName() })
      subtitle.textContent = ['purchasing', 'accounting', 'marketing'].includes(topic) ? t('department.plannedIntro') : t('topic.intro')
      if (hrForm) {
        hrSummary.textContent = t('department.queryTools')
        hrTitle.textContent = t('department.attendance'); hrHint.textContent = t('department.attendanceHint'); hrFuture.textContent = t('department.hrPlanned')
        hrDateLabel.firstChild.textContent = t('department.date'); hrPrepare.textContent = t('department.prepare')
        hrMissing.textContent = t('department.prepareMissing')
        hrCompare.textContent = t('department.prepareComparison')
      }
      toolSummary.textContent = t('topic.tools'); toolOpen.textContent = t('topic.original')
      titleLabel.firstChild === titleInput && titleLabel.insertBefore(n('span'), titleInput)
      nextLabel.firstChild === nextInput && nextLabel.insertBefore(n('span'), nextInput)
      titleLabel.firstChild.textContent = t('topic.noteTitle'); nextLabel.firstChild.textContent = t('topic.nextStep'); add.textContent = t('topic.add')
      titleInput.placeholder = t('topic.notePlaceholder'); nextInput.placeholder = t('topic.nextPlaceholder'); draw()
    }
    var stateName = { todo: function () { return t('topic.todo') }, doing: function () { return t('topic.doing') }, done: function () { return t('topic.done') } }
    function draw () {
      trackingSummary.textContent = t('topic.followUps', { count: data ? data.notes.filter(function (v) { return v.state !== 'done' }).length : '?' })
      notes.replaceChildren(); if (!data) return
      if (!data.notes.length) notes.append(n('p', t('topic.empty'), 'topic-empty'))
      data.notes.forEach(function (v) {
        var row = n('article', null, 'topic-note'), text = n('div'), controls = n('form'), state = n('select'), next = n('input'), save = n('button')
        row.dataset.noteId = v.id; text.append(n('strong', v.title), n('p', t('topic.ownerNote'), 'topic-source'))
        if (v.source && v.source.kind === 'investigation') {
          text.append(evidenceDetails(v.source.snapshot, v.source))
          var recheck = n('button', t('followup.recheck')); recheck.type = 'button'; text.append(recheck)
          recheck.addEventListener('click', function () {
            var query = v.source.reportKind === 'comparison' ? t('department.comparisonRequest', { date: v.source.queryDate }) : t('department.missingRequest', { date: v.source.queryDate })
            status.textContent = onDiscuss(query) === false ? t('topic.draftBusy') : t('department.queryPrepared')
          })
        } else if (v.source) { var ref = n('p', t('topic.mailReference', { mailbox: v.source.mailbox, id: v.source.messageId }), 'topic-source'); text.append(ref) }
        state.setAttribute('aria-label', t('topic.state')); next.setAttribute('aria-label', t('topic.nextStep')); next.maxLength = 600; next.value = v.nextStep; next.placeholder = t('topic.nextPlaceholder')
        Object.keys(stateName).forEach(function (key) { var opt = n('option', stateName[key]()); opt.value = key; state.append(opt) }); state.value = v.state
        save.type = 'submit'; save.textContent = t('topic.save'); controls.append(state, next, save); row.append(text, controls); notes.append(row)
        controls.addEventListener('submit', async function (event) { event.preventDefault(); save.disabled = true; try { var value = await api('/notes/' + v.id, 'PUT', { revision: v.revision, state: state.value, nextStep: next.value }); data.notes[data.notes.findIndex(function (a) { return a.id === v.id })] = value.note; draw(); status.textContent = t('topic.saved') } catch (_) { status.textContent = t('topic.saveFailed') } finally { save.disabled = false } })
      })
      sourceHint.textContent = source ? t('topic.mailReference', { mailbox: source.mailbox, id: source.messageId }) : ''
    }
    async function api (suffix, method, body) {
      var controller = new AbortController(), timer = setTimeout(function () { controller.abort() }, 10000)
      try {
        var response = await fetch('/api/v1/topic-workspaces/' + topic + suffix, { signal: controller.signal, method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
        var value = await response.json()
        if (!response.ok) throw Error(value.error === 'workspace_capacity' ? 'workspace_capacity' : 'topic_request_failed'); return value
      } finally { clearTimeout(timer) }
    }
    function findingText (key) {
      if (key === 'later_clock_in') return t('followup.laterIn')
      if (key === 'earlier_clock_in') return t('followup.earlierIn')
      if (key === 'earlier_clock_out') return t('followup.earlierOut')
      if (key === 'later_clock_out') return t('followup.laterOut')
      if (key === 'unclosed_after_scheduled_end' || key === 'unclosed_historical') return t('followup.historicalOpen')
      if (key === 'unclosed_before_scheduled_end' || key === 'unclosed_current') return t('followup.currentOpen')
      if (key === 'no_linked_punch' || key === 'unmatched_punch') return t('followup.unmatched')
      if (key === 'approximate_match') return t('followup.approximate')
      if (key === 'auto_clocked_out') return t('followup.autoOut')
      if (key === 'link_contradiction') return t('followup.contradiction')
      if (key === 'unassigned_shift') return t('followup.unassigned')
      return t('followup.futureStart')
    }
    function evidenceDetails (candidate, report) {
      var details = n('details', null, 'followup-evidence'), e = candidate.evidence
      var localTime = function (value) { return value === null ? 'UNKNOWN' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Winnipeg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).format(new Date(value)) }
      details.append(n('summary', t('followup.source')))
      details.append(n('p', t('followup.snapshot', { date: report.queryDate, at: report.retrievedAt })))
      details.append(n('p', report.completeWithinScope ? t('followup.complete') : t('followup.partial')))
      details.append(n('p', t('followup.recordIds', { company: report.companyId, user: e.userId == null ? 'UNKNOWN' : e.userId, shift: e.shiftId == null ? 'UNKNOWN' : e.shiftId, punches: e.punchIds.join(', ') || 'UNKNOWN' })))
      details.append(n('p', t('followup.times', { start: localTime(e.scheduledStart), end: localTime(e.scheduledEnd), clockIn: localTime(e.clockedIn), clockOut: localTime(e.clockedOut) })))
      details.append(n('p', t('followup.grade', { grade: e.matchState })))
      details.append(n('p', t('followup.reference', { id: report.reportId || report.id, conversation: report.conversationId })))
      details.append(n('p', e.findings.map(findingText).join(' · ')))
      return details
    }
    function offer (host, reference) {
      if (topic !== 'hr' || !reference) return
      var opener = n('button', t('followup.prepare'), 'followup-prepare'); opener.type = 'button'; host.append(opener)
      opener.addEventListener('click', async function () {
        if (opener.disabled) return; opener.disabled = true
        var viewer = null
        try {
          await loaded
          var result = await api('/follow-up-candidates?conversationId=' + encodeURIComponent(reference.conversationId) + '&reportId=' + encodeURIComponent(reference.reportId)), report = result.report
          viewer = n('dialog', null, 'followup-viewer'); viewer.setAttribute('aria-label', t('followup.title'))
          var head = n('div', null, 'followup-head'), close = n('button', t('report.closeTable')), list = n('div', null, 'followup-candidates'), footer = n('div', null, 'followup-footer'), save = n('button', t('followup.confirm')), output = n('p', '', 'topic-status')
          close.type = 'button'; head.append(n('strong', t('followup.title')), close); output.setAttribute('role', 'status')
          viewer.append(head, n('p', t('followup.boundary')), n('p', t('followup.snapshot', { date: report.queryDate, at: report.retrievedAt })), list, footer); footer.append(save, output)
          var choices = []
          report.candidates.forEach(function (candidate) {
            var row = n('article', null, 'followup-candidate'), label = n('label'), check = n('input'), e = candidate.evidence
            check.type = 'checkbox'; check.value = candidate.key; check.disabled = !!candidate.existingNoteId
            label.append(check, n('strong', (candidate.employeeName || 'ID ' + e.userId) + ' · ' + report.queryDate)); row.append(label, n('p', e.findings.map(findingText).join(' · ')), evidenceDetails(candidate, report))
            if (candidate.existingNoteId) row.append(n('p', t('followup.existing')))
            choices.push(check); list.append(row)
          })
          if (!choices.length) list.append(n('p', t('followup.empty')))
          save.type = 'button'; save.disabled = true
          list.addEventListener('change', function () { var count = choices.filter(function (c) { return c.checked && !c.disabled }).length; save.disabled = count < 1 || count > 100; output.textContent = count > 100 ? t('followup.capacity') : '' })
          var saving = false
          save.addEventListener('click', async function () {
            if (saving) return; saving = true; save.disabled = true
            try {
              var value = await api('/evidence-follow-ups', 'POST', { conversationId: reference.conversationId, reportId: reference.reportId, keys: choices.filter(function (c) { return c.checked && !c.disabled }).map(function (c) { return c.value }), confirmed: true })
              var refreshed = await api(''); data = refreshed.workspace; draw()
              output.textContent = t('followup.saved', { count: value.notes.length, reused: value.reused }); choices.forEach(function (c) { if (c.checked) c.disabled = true })
              status.textContent = output.textContent
            } catch (error) { output.textContent = error.message === 'workspace_capacity' ? t('followup.capacity') : t('topic.saveFailed') } finally { saving = false; save.disabled = !choices.some(function (c) { return c.checked && !c.disabled }) }
          })
          close.addEventListener('click', function () { viewer.close() }); viewer.addEventListener('close', function () { viewer.remove(); opener.focus() }); doc.body.append(viewer); viewer.showModal()
        } catch (_) { if (viewer) viewer.remove(); status.textContent = t('followup.unavailable') } finally { opener.disabled = false }
      })
    }
    var loaded = api('').then(function (value) { data = value.workspace; labels(); return value }).catch(function () { status.textContent = t('topic.loadFailed'); add.disabled = true; throw Error('topic_load_failed') })
    loaded.catch(function () {})
    form.addEventListener('submit', async function (event) {
      event.preventDefault(); if (inflight || !data || !titleInput.value.trim()) return; inflight = true; add.disabled = true
      try { var result = await api('/notes', 'POST', { requestId: requestId, title: titleInput.value.trim(), nextStep: nextInput.value.trim(), source: source }); if (!data.notes.some(function (n) { return n.id === result.note.id })) data.notes.push(result.note); titleInput.value = ''; nextInput.value = ''; source = null; requestId = root.crypto.randomUUID(); draw(); status.textContent = t('topic.saved') }
      catch (_) { status.textContent = t('topic.saveFailed') } finally { inflight = false; add.disabled = false }
    })
    root.addEventListener('message', function (event) {
      if (topic !== 'email' || !frame || event.origin !== root.location.origin || event.source !== frame.contentWindow) return
      var v = event.data
      if (!v || v.type !== 'xiangxiang-email-context' || !['owner', 'admin'].includes(v.mailbox) || !/^[a-f0-9]{1,100}$/i.test(v.messageId) || typeof v.title !== 'string') return
      if (v.action === 'track') { source = { mailbox: v.mailbox, messageId: v.messageId }; titleInput.value = v.title.slice(0, 160); tracking.open = true; draw(); nextInput.focus() }
      if (v.action === 'discuss' && onDiscuss(t('topic.discussEmail', { mailbox: v.mailbox === 'admin' ? t('topic.adminMailbox') : t('topic.ownerMailbox'), id: v.messageId })) === false) status.textContent = t('topic.draftBusy')
    })
    labels()
    return {
      topic: topic,
      load: function () { return loaded },
      link: async function (id) { try { await loaded; var result = await api('/conversations', 'POST', { id: id }); data.conversationIds = result.workspace.conversationIds; data.lastConversationId = id; return true } catch (_) { status.textContent = t('topic.saveFailed'); return false } },
      selected: function (id) { if (data && data.conversationIds.includes(id) && id !== data.lastConversationId) this.link(id) },
      labels: labels,
      offer: offer,
      submitted: function () { if (hrTools) { hrTools.open = false; tracking.open = false } }
    }
  }
  root.XiangxiangTopics = { mount: mount }
})(typeof window === 'object' ? window : this)
