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
    var title = doc.getElementById('conv-title')
    var titleReference = title && title.parentNode === header ? title : null
    var brand = doc.getElementById('brand-name'), sideTop = brand && brand.parentNode
    if (brand) header.insertBefore(brand, titleReference)
    if (sideTop) { sideTop.hidden = true; sideTop.inert = true }

    var navigation = doc.createElement('div')
    navigation.className = 'top-navigation'
    // DOM order and visual order both lead with navigation, then the conversation title.
    header.insertBefore(navigation, titleReference)
    var places = doc.getElementById('places')
    if (!places) {
      places = doc.createElement('nav')
      places.id = 'places'
      places.className = 'places'
    }
    navigation.appendChild(places)
    var home = doc.getElementById('open-home')
    if (home) places.appendChild(home)

    // Retain the workspace label for existing language updates, without a duplicate entry.
    var oldWorkspace = nav.parentNode
    navigation.appendChild(nav)
    if (oldWorkspace && oldWorkspace !== sidebar &&
        (oldWorkspace.tagName === 'DETAILS' || oldWorkspace.classList.contains('side-workspace'))) {
      oldWorkspace.hidden = true
      oldWorkspace.inert = true
      oldWorkspace.setAttribute('aria-hidden', 'true')
    }

    function closeGroups (except) {
      Object.keys(groups).forEach(function (key) {
        if (groups[key] !== except) groups[key].open = false
      })
    }
    function positionMenu (group) {
      var view = doc.defaultView, trigger = group.children[0], menu = group.children[1]
      if (!group.open || !view || !trigger.getBoundingClientRect || !menu.getBoundingClientRect) return
      var viewport = view.visualViewport
      var width = viewport ? viewport.width : view.innerWidth
      var height = viewport ? viewport.height : view.innerHeight
      if (!(width > 0 && height > 0)) return
      var originX = viewport ? viewport.offsetLeft : 0
      var originY = viewport ? viewport.offsetTop : 0
      var edge = 12, gap = 8
      var rect = trigger.getBoundingClientRect()
      var menuWidth = menu.getBoundingClientRect().width
      var left = Math.max(originX + edge, Math.min(rect.left, originX + width - menuWidth - edge))
      var top = Math.max(originY + edge, Math.min(rect.bottom + gap, originY + height - edge - 44))
      menu.style.left = left + 'px'
      menu.style.top = top + 'px'
      menu.style.maxHeight = Math.max(0, originY + height - edge - top) + 'px'
    }
    function positionOpenMenus () {
      Object.keys(groups).forEach(function (key) { positionMenu(groups[key]) })
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
      // Native summaries turn Enter/Space into clicks. Handle that click synchronously
      // so a newly opened menu is bounded and exclusive before the delayed toggle event.
      summary.addEventListener('click', function (event) {
        event.preventDefault()
        var opening = !group.open
        closeGroups(group)
        group.open = opening
        positionMenu(group)
      })
      group.addEventListener('toggle', function () {
        if (!group.open) return
        closeGroups(group)
        positionMenu(group)
      })
    })
    var settings = doc.getElementById('open-settings')
    if (settings) navigation.appendChild(settings)

    function updateLabels (next) {
      Object.keys(DESTINATIONS).forEach(function (key) {
        if (next && typeof next[key] === 'string') groups[key].children[0].textContent = next[key]
      })
      positionOpenMenus()
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
    function escapeMenu (event) {
      if (event.key !== 'Escape' || event.defaultPrevented || editing(event.target)) return
      Object.keys(DESTINATIONS).some(function (key) {
        var group = groups[key]
        if (!group.open) return false
        group.open = false
        group.children[0].focus()
        event.preventDefault()
        event.stopPropagation()
        return true
      })
    }
    navigation.addEventListener('keydown', escapeMenu)
    doc.addEventListener('keydown', escapeMenu)
    navigation.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('button')) closeGroups()
    })
    doc.addEventListener('click', function (event) {
      if (!navigation.contains(event.target)) closeGroups()
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
    var view = doc.defaultView
    if (view && view.addEventListener) view.addEventListener('resize', positionOpenMenus)
    if (view && view.visualViewport && view.visualViewport.addEventListener) {
      view.visualViewport.addEventListener('resize', positionOpenMenus)
      view.visualViewport.addEventListener('scroll', positionOpenMenus)
    }
    updateLabels(labels)
    show(!!(view && view.matchMedia && view.matchMedia('(max-width: 760px)').matches), false)
    var controller = { groups: groups, updateLabels: updateLabels }
    sidebar.sidebarController = controller
    return controller
  }
  return { mount: mount }
})
