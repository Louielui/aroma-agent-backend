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
    var sidebar = doc.getElementById('sidebar'), nav = doc.getElementById('workspace-nav')
    var expand = doc.getElementById('expand'), collapse = doc.getElementById('collapse')
    var main = doc.getElementById('main')
    if (!sidebar || !nav || !expand || !collapse || !main) return null
    if (sidebar.sidebarController) {
      sidebar.sidebarController.updateLabels(labels)
      return sidebar.sidebarController
    }

    var container = main.parentNode
    if (!container || sidebar.parentNode !== container) return null
    var groups = {}, collapsedState = false
    var header = doc.getElementById('topbar') || doc.getElementById('page-header')
    if (!header) {
      header = doc.createElement('header')
      header.appendChild(expand)
    }
    header.classList.add('top-feature-header')
    container.classList.add('sidebar-layout')

    // Keep the header outside all conversation views, including the centred empty view.
    var body = doc.createElement('div')
    body.className = 'sidebar-body'
    container.insertBefore(body, sidebar)
    body.appendChild(sidebar)
    body.appendChild(main)
    container.insertBefore(header, body)
    if (!header.contains(expand)) header.insertBefore(expand, header.firstChild)
    header.insertBefore(collapse, expand)
    var brand = doc.getElementById('brand-name'), sideTop = brand && brand.parentNode
    if (brand) header.insertBefore(brand, doc.getElementById('conv-title'))
    if (sideTop) { sideTop.hidden = true; sideTop.inert = true }

    var navigation = doc.createElement('div')
    navigation.className = 'top-navigation'
    header.appendChild(navigation)
    var places = doc.getElementById('places')
    if (!places) {
      places = doc.createElement('nav')
      places.id = 'places'
      places.className = 'places'
    }
    navigation.appendChild(places)
    var home = doc.getElementById('open-home')
    if (home) places.appendChild(home)

    // Retain the old workspace label for the existing language-update code,
    // but leave no empty disclosure or duplicate destination in the sidebar.
    var oldWorkspace = nav.parentNode
    navigation.appendChild(nav)
    if (oldWorkspace && oldWorkspace !== sidebar &&
        (oldWorkspace.tagName === 'DETAILS' || oldWorkspace.classList.contains('side-workspace'))) {
      oldWorkspace.hidden = true
      oldWorkspace.inert = true
      oldWorkspace.setAttribute('aria-hidden', 'true')
    }

    Object.keys(DESTINATIONS).forEach(function (key) {
      var group = doc.createElement('details'), summary = doc.createElement('summary'), menu = doc.createElement('div')
      group.className = 'sidebar-group'
      group.setAttribute('data-sidebar-group', key)
      group.open = false
      group.appendChild(summary)
      menu.className = 'top-menu'
      group.appendChild(menu)
      nav.appendChild(group)
      groups[key] = group
      DESTINATIONS[key].forEach(function (id) {
        var item = doc.getElementById(id)
        if (item) menu.appendChild(item)
      })
      group.addEventListener('toggle', function () {
        if (group.open) Object.keys(groups).forEach(function (other) { if (other !== key) groups[other].open = false })
      })
      // Native summaries supply Enter/Space activation and ordinary Tab order.
    })
    var settings = doc.getElementById('open-settings')
    if (settings) navigation.appendChild(settings)

    function updateLabels (next) {
      Object.keys(DESTINATIONS).forEach(function (key) {
        if (next && typeof next[key] === 'string') groups[key].children[0].textContent = next[key]
      })
    }
    function show (collapsed, focus) {
      collapsedState = !!collapsed
      sidebar.classList.toggle('collapsed', collapsedState)
      sidebar.inert = collapsedState
      sidebar.setAttribute('aria-hidden', String(collapsedState))
      expand.classList.add('icon-btn')
      expand.classList.toggle('hidden', !collapsedState)
      expand.setAttribute('aria-controls', 'sidebar')
      expand.setAttribute('aria-expanded', String(!collapsedState))
      collapse.setAttribute('aria-controls', 'sidebar')
      collapse.setAttribute('aria-expanded', String(!collapsedState))
      collapse.classList.toggle('hidden', collapsedState)
      if (focus) (collapsedState ? expand : collapse).focus()
    }
    function editing (target) {
      return target && target.closest && target.closest('input, textarea, select, [contenteditable], dialog, [role="dialog"]')
    }
    navigation.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.defaultPrevented || editing(event.target)) return
      var active = doc.activeElement
      Object.keys(DESTINATIONS).some(function (key) {
        var group = groups[key]
        if (!group.open || !group.contains(active)) return false
        group.open = false
        group.children[0].focus()
        event.preventDefault()
        event.stopPropagation()
        return true
      })
    })
    navigation.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('button')) Object.keys(groups).forEach(function (key) { groups[key].open = false })
    })
    doc.addEventListener('click', function (event) {
      if (!navigation.contains(event.target)) Object.keys(groups).forEach(function (key) { groups[key].open = false })
    })
    sidebar.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.defaultPrevented || collapsedState || editing(event.target)) return
      if (!sidebar.contains(doc.activeElement)) return
      event.preventDefault()
      event.stopPropagation()
      show(true, true)
    })
    collapse.addEventListener('click', function () { show(true, true) })
    expand.addEventListener('click', function () { show(false, true) })
    updateLabels(labels)
    show(!!(doc.defaultView && doc.defaultView.matchMedia && doc.defaultView.matchMedia('(max-width: 760px)').matches), false)
    var controller = { groups: groups, updateLabels: updateLabels }
    sidebar.sidebarController = controller
    return controller
  }
  return { mount: mount }
})
