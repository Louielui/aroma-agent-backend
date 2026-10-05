/* Owner topic workspaces. External source text remains data; this controller grants no execution authority. */
;(function (root) {
  'use strict'
  var TOPICS = {
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
    toolOpen.href = TOPICS[topic][1]; toolOpen.target = '_blank'; toolOpen.rel = 'noopener'; toolOpen.className = 'topic-original'
    var frame = null
    tools.addEventListener('toggle', function () { if (tools.open && !frame) { frame = n('iframe'); frame.src = TOPICS[topic][1]; frame.title = topicName(); frame.className = 'topic-tool-frame'; tools.append(frame) } })
    var tracking = n('details', null, 'topic-tracking'), trackingSummary = n('summary'), notes = n('div'), form = n('form', null, 'topic-note-form')
    tracking.id = 'topic-follow-ups'; tracking.append(trackingSummary, notes, form); box.append(tracking)
    var titleLabel = n('label'), nextLabel = n('label'), titleInput = n('input'), nextInput = n('input'), add = n('button'), sourceHint = n('p', '', 'topic-source')
    titleInput.id = 'topic-note-title'; titleInput.maxLength = 160; titleInput.required = true; nextInput.id = 'topic-note-next'; nextInput.maxLength = 600
    titleLabel.append(titleInput); nextLabel.append(nextInput); add.type = 'submit'; form.append(titleLabel, nextLabel, sourceHint, add)
    var data = null, source = null, requestId = root.crypto.randomUUID(), inflight = false
    function labels () {
      title.textContent = t('topic.title', { name: topicName() }); subtitle.textContent = t('topic.intro')
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
        if (v.source) { var ref = n('p', t('topic.mailReference', { mailbox: v.source.mailbox, id: v.source.messageId }), 'topic-source'); text.append(ref) }
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
        if (!response.ok) throw Error('topic_request_failed'); return await response.json()
      } finally { clearTimeout(timer) }
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
      load: function () { return loaded },
      link: async function (id) { try { await loaded; var result = await api('/conversations', 'POST', { id: id }); data.conversationIds = result.workspace.conversationIds; data.lastConversationId = id; return true } catch (_) { status.textContent = t('topic.saveFailed'); return false } },
      selected: function (id) { if (data && data.conversationIds.includes(id) && id !== data.lastConversationId) this.link(id) },
      labels: labels
    }
  }
  root.XiangxiangTopics = { mount: mount }
})(typeof window === 'object' ? window : this)
