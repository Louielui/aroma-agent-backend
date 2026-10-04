/* Presentation only. No credentials, requests, task authority or history writes. */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.XiangxiangSidebar = factory()
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict'
  var DESTINATIONS = {
    daily: ['open-manager', 'open-drive-context', 'open-aroma-context', 'open-calendar-context', 'open-gmail-context'],
    development: ['open-live-context', 'open-development-plan', 'open-project-tasks', 'open-workers'],
    management: ['open-memory', 'open-connections', 'open-company-access', 'open-architecture']
  }
  function mount (doc, labels) {
    var sidebar = doc.getElementById('sidebar'), nav = doc.getElementById('workspace-nav'), expand = doc.getElementById('expand'), collapse = doc.getElementById('collapse')
    if (!sidebar || !nav || !expand || !collapse) return null
    if (sidebar.sidebarController) return sidebar.sidebarController
    var collapsedState = false, groups = {}
    function show (collapsed, focus) {
      collapsedState = collapsed; sidebar.className = collapsed ? 'collapsed' : ''
      // Inert prevents keyboard focus from reaching the offscreen destinations.
      sidebar.inert = collapsed; sidebar.setAttribute('aria-hidden', String(collapsed))
      expand.className = collapsed ? 'icon-btn' : 'icon-btn hidden'
      expand.setAttribute('aria-controls', 'sidebar'); expand.setAttribute('aria-expanded', String(!collapsed))
      collapse.setAttribute('aria-controls', 'sidebar'); collapse.setAttribute('aria-expanded', String(!collapsed))
      if (focus) (collapsed ? expand : collapse).focus()
    }
    Object.keys(DESTINATIONS).forEach(function (key) {
      var group = doc.createElement('details'), summary = doc.createElement('summary')
      group.className = 'sidebar-group'; group.setAttribute('data-sidebar-group', key); group.open = true
      summary.textContent = labels[key]; group.appendChild(summary); nav.appendChild(group); groups[key] = group
      DESTINATIONS[key].forEach(function (id) { var item = doc.getElementById(id); if (item) group.appendChild(item) })
    })
    collapse.addEventListener('click', function () { show(true, true) })
    expand.addEventListener('click', function () { show(false, true) })
    doc.addEventListener('keydown', function (event) {
      // Escape closes navigation only when focus is inside it; dialogs retain their own Escape.
      if (event.key === 'Escape' && !collapsedState && (!sidebar.contains || sidebar.contains(doc.activeElement))) show(true, true)
    })
    show(false, false)
    var controller = { groups: groups }
    sidebar.sidebarController = controller
    return controller
  }
  return { mount: mount }
})
