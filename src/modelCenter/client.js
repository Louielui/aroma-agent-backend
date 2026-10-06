;(function () {
  'use strict'
  var lang = new URLSearchParams(location.search).get('lang') || INITIAL_LOCALE, t = createResolver({ catalogue: CATALOGUE, locale: lang })
  var by = function (id) { return document.getElementById(id) }, data = null, busy = false
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'
  by('title').textContent = t('brain.title'); document.title = t('brain.title')
  by('intro').textContent = t('brain.intro'); by('brain-title').textContent = t('brain.defaultTitle')
  by('rules').textContent = t('brain.rules'); by('provider-label').textContent = t('brain.company'); by('model-label').textContent = t('brain.model'); by('effort-label').textContent = t('brain.effort')
  by('save').textContent = t('brain.save'); by('back').textContent = t('brain.back'); by('architecture').textContent = t('brain.architecture')
  by('roles-title').textContent = t('brain.roles'); by('roles-note').textContent = t('brain.rolesNote'); by('billing').textContent = t('brain.billing')
  var levels = { auto: function () { return t('chat.auto') }, low: function () { return t('chat.low') }, medium: function () { return t('chat.medium') }, high: function () { return t('chat.high') }, xhigh: function () { return t('chat.xhigh') }, max: function () { return t('chat.max') }, ultra: function () { return t('chat.ultra') } }
  function option (select, value, label, disabled) { var o = document.createElement('option'); o.value = value; o.textContent = label; o.disabled = !!disabled; select.appendChild(o) }
  function efforts (chosen) {
    var row = data.models.find(function (v) { return v.model === by('model').value }), list = row && (row.supportsEffort === false ? ['auto'] : row.efforts) || []
    by('effort').replaceChildren(); list.forEach(function (v) { option(by('effort'), v, levels[v] ? levels[v]() : v) })
    by('effort').value = list.includes(chosen) ? chosen : list.includes('medium') ? 'medium' : list[0] || ''
    by('effort').disabled = busy || !row || row.supportsEffort === false; by('save').disabled = busy || !row || row.available !== true || !list.length
  }
  function models (chosen) {
    by('model').replaceChildren()
    data.models.filter(function (r) { return (r.model.startsWith('claude-') ? 'claude' : 'openai') === by('company').value }).forEach(function (r) { option(by('model'), r.model, r.name, !r.available) })
    if (Array.from(by('model').options).some(function (o) { return o.value === chosen })) by('model').value = chosen
    efforts(data.brain.model === by('model').value ? data.brain.effort : 'medium')
  }
  function render () {
    by('company').value = data.brain.model.startsWith('claude-') ? 'claude' : 'openai'; models(data.brain.model)
    var row = data.models.find(function (r) { return r.model === data.brain.model })
    by('effective').textContent = t('brain.effective', { model: row ? row.name : data.brain.model, effort: data.brain.effort })
    by('roles').replaceChildren(); (data.roles || []).forEach(function (r) { var div = document.createElement('div'), title = document.createElement('strong'), value = document.createElement('span'), status = document.createElement('small'); div.className = 'role'; title.textContent = r.role; value.textContent = r.selection; status.textContent = r.status; div.append(title, value, status); by('roles').append(div) })
  }
  async function request (path, body) {
    var r = await fetch(path, { method: body ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) })
    if (!r.ok) throw Error(r.status === 409 ? 'conflict' : 'unavailable'); return r.json()
  }
  by('company').addEventListener('change', function () { if (data) models() }); by('model').addEventListener('change', function () { if (data) efforts('medium') })
  by('brain-form').addEventListener('submit', async function (e) {
    e.preventDefault(); if (!data || busy) return; busy = true; by('save').disabled = true; by('company').disabled = true; by('model').disabled = true; by('effort').disabled = true
    try { var result = await request('/api/v1/model-center/brain', { revision: data.revision, model: by('model').value, effort: by('effort').value }); data.revision = result.revision; data.brain = result.brain; by('status').textContent = t('brain.saved'); busy = false; render() }
    catch (err) { by('status').textContent = err.message === 'conflict' ? t('brain.conflict') : t('brain.failed'); busy = false; efforts(by('effort').value) }
    finally { by('company').disabled = false; by('model').disabled = false }
  })
  request('/api/v1/model-center?lang=' + encodeURIComponent(lang)).then(function (v) { data = v; render() }).catch(function () { by('status').textContent = t('brain.failed') })
})()
