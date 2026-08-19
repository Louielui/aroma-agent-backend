'use strict'

/**
 * aromaSystem.js — A PINNED STRUCTURAL SNAPSHOT of Aroma System navigation truth.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ PINNED, NOT LIVE. Every record below was read from ONE commit of another repository and
 * written down here. It is not current truth and must never be described as such: if that
 * repo's navigation changes, this file is stale until somebody re-reads it and commits the
 * new snapshot. `sourceRef`/`sourceCommit` exist so staleness is visible rather than assumed.
 *
 * ⛔ AND IT IS A SNAPSHOT PRECISELY SO PRODUCTION NEVER READS A DEVELOPER CHECKOUT. Nothing
 * here touches the filesystem. Aroma's availability cannot depend on a folder existing on one
 * machine, and a catalogue that reads someone's working tree would be reporting whatever that
 * person happened to have checked out.
 *
 * ⛔ THE SNAPSHOT REF IS NOT AN EXECUTION BRANCH. It was taken from a feature branch because
 * that is what the checkout was on. Which branch an executor would ever run against is a
 * completely separate decision, made in a later tranche, and reading this field as 「the branch
 * to build」 would be exactly the kind of quiet promotion this file exists to prevent.
 *
 * ── HOW EACH RECORD WAS ESTABLISHED ─────────────────────────────────────────
 * Owner-facing label      Layout.tsx   label + path (+ activePrefixes)
 * route → component       App.tsx      <Route path=… component={… X …} />
 * component → file        App.tsx      import X from "./pages/X"
 *
 * ⛔ NEVER FROM A FILENAME. The three records below exist because filename resemblance points
 * the WRONG WAY here, and a catalogue built on it would be confidently wrong — see each
 * record's own note.
 *
 * ⛔ NOT navConfig.ts. That module manages role→tab ids, user tab overrides and locked tabs.
 * It is not the owner-facing page/component registry and is not a source here.
 *
 * ⛔ NO INVENTED ALIASES. Not 訂貨頁, not 中央廚房訂貨頁, not 補貨頁, not 「v2」. Only labels that
 * literally appear in checked-in source. An Owner-reviewed alias is a different, later, and
 * governed thing; a model's suggestion is never trusted data at all.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** Where every record below came from. One commit, read once, recorded here. */
const SOURCE = Object.freeze({
  projectId: 'aroma-system',
  repoFullName: 'Louielui/aroma-system',
  /** The ref the checkout happened to be on — provenance only. NOT an execution branch. */
  sourceRef: 'feat/aroma-core-slice1',
  sourceCommit: '9a08646565c00f503e042dbf07b23b4a41a09e34',
  sourceFiles: Object.freeze([
    'client/src/components/Layout.tsx',
    'client/src/App.tsx'
  ])
})

/**
 * Closed. How a target may be addressed.
 *
 * OWNER_LABEL — a label the Owner actually sees, taken verbatim from Layout.tsx. Only these
 *               may ever be matched by label.
 * ROUTE_ONLY  — reachable by route, with NO owner-facing label in the navigation. Its
 *               canonicalLabel is null and it is invisible to label lookup, because giving it
 *               a plausible-sounding name would be inventing one.
 */
const DISCOVERABILITY = Object.freeze({
  OWNER_LABEL: 'owner_label',
  ROUTE_ONLY: 'route_only'
})

const TARGETS = Object.freeze([
  Object.freeze({
    targetId: 'aroma-system:order-planning',
    projectId: 'aroma-system',
    canonicalLabel: 'Order Planning',
    discoverability: DISCOVERABILITY.OWNER_LABEL,
    routes: Object.freeze(['/inventory/replenishment', '/procurement/replenishment']),
    component: 'Replenishment',
    files: Object.freeze(['client/src/pages/Replenishment.tsx']),
    /**
     * ⛔ THE TRAP, AND WHY THIS RECORD IS THE POINT OF THE WHOLE FILE. The page the Owner
     * knows as 「Order Planning」 is Replenishment.tsx. A separate file literally named
     * OrderPlanning.tsx also exists and is NOT this page. Matching by filename would pick the
     * wrong one with complete confidence.
     */
    evidence: Object.freeze({
      label: 'client/src/components/Layout.tsx:175 label: "Order Planning"',
      path: 'client/src/components/Layout.tsx:176 path: "/inventory/replenishment"; :178 activePrefixes ["/inventory/replenishment","/procurement/replenishment"]',
      route: 'client/src/App.tsx:290 /inventory/replenishment -> Replenishment; :328 /procurement/replenishment -> Replenishment',
      file: 'client/src/App.tsx:65 import Replenishment from "./pages/Replenishment"'
    })
  }),

  Object.freeze({
    targetId: 'aroma-system:inventory-order-planning-route',
    projectId: 'aroma-system',
    /**
     * ⛔ NULL, AND IT STAYS NULL. This route has NO entry in Layout.tsx, so no owner-facing
     * label for it exists in checked-in source. 「Order Planning v2」 would be a name I made up
     * because the filename suggested it — which is the exact failure this catalogue is built
     * to refuse. It is addressable by route and is invisible to label lookup.
     */
    canonicalLabel: null,
    discoverability: DISCOVERABILITY.ROUTE_ONLY,
    routes: Object.freeze(['/inventory/order-planning']),
    component: 'OrderPlanning',
    files: Object.freeze(['client/src/pages/OrderPlanning.tsx']),
    evidence: Object.freeze({
      label: 'NONE — no entry for /inventory/order-planning exists in client/src/components/Layout.tsx',
      route: 'client/src/App.tsx:259 /inventory/order-planning -> OrderPlanning',
      file: 'client/src/App.tsx:26 import OrderPlanning from "./pages/OrderPlanning"'
    })
  }),

  Object.freeze({
    targetId: 'aroma-system:branches-replenishment',
    projectId: 'aroma-system',
    canonicalLabel: 'Replenishment',
    discoverability: DISCOVERABILITY.OWNER_LABEL,
    routes: Object.freeze(['/branches/replenishment']),
    component: 'TransferOrders',
    files: Object.freeze(['client/src/pages/TransferOrders.tsx']),
    /**
     * ⛔ THE SECOND TRAP, IN THE OPPOSITE DIRECTION. Its route contains 「replenishment」 and its
     * label IS 「Replenishment」, yet it renders TransferOrders — a different component and a
     * different file from the Order Planning target above. Collapsing the two on the strength
     * of a shared word would put the Owner's approved change into the wrong page. Component
     * identity is what separates them, not the route string.
     */
    evidence: Object.freeze({
      label: 'client/src/components/Layout.tsx:347 label: "Replenishment"',
      path: 'client/src/components/Layout.tsx:348 path: "/branches/replenishment"',
      route: 'client/src/App.tsx:288 /branches/replenishment -> TransferOrders',
      file: 'client/src/App.tsx:64 import TransferOrders from "./pages/TransferOrders"'
    })
  })
])

module.exports = { SOURCE, TARGETS, DISCOVERABILITY }
