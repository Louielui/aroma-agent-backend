# REPORT B — BUSINESS MAP / CAPABILITY MAP AUDIT

**REPORT ONLY. No code written, nothing merged, restarted or deployed.**
Audited read-only from the aroma-system source and the six live shapes captured 2026-08-08.

---

## 0. THE HEADLINE

> **The capability map 香香 holds covers 6 endpoints. The AI-facing surface is 24 routes across
> four routers. The business behind it is 115 route files.**
>
> She can read six things, cannot write anything, and has no representation of the other
> ~109 domains — including the two the Owner's own backlog is about.

---

## 1. CURRENT DOMAINS

115 route files in `aroma-system/server/routes/`. Grouped by what they serve:

| domain | representative routes | reachable by 香香? |
|---|---|---|
| **Inventory & stock** | inventory, inventoryLedger, inventoryProjected, inventoryState, inventoryClasses, stockTake, storageLocations, ingredientLocations | **1 of 8** (`/inventory`) |
| **Purchasing** | purchaseOrders, replenishmentSuggestions, standingOrders, branchOrder, portalOrders, branchReceiving | **1 of 6** (`/order-planning`) |
| **Suppliers** | suppliers, supplierContacts, supplierDocuments, supplierTags, localSupplierOffers | **1 of 5** |
| **Invoices & documents** | localInvoices, invoiceIntake, invoiceDriveArchive, scanInbox, driveImport, statements | **1 of 6** |
| **Ingredients & master data** | rawIngredients, draftIngredients, ingredientCategories, ingredientCosting, ingredientMerge, ingredientOnboarding ×3, ingredientPicker, ingredientProposals, masterItems, masterDataAcceleration, units | **0** (an AI *write* path exists — §3) |
| **Pricing** | priceBook, priceBookIngredients | **0** |
| **Recipes** | recipes, recipeBooks, recipeCategories, saleItems, serviceItems, finishedGoods, finishedGoodsMovements | **0** |
| **Prep & production** | prepEngine, prepPlanning, prepList, prepItems, prepCosting, prepCalendar, prepExecution, prepProductionTasks, prepStations, todayPrep, weeklyPrepPlan, productionDemand, productionRates | **0** (a *write* path exists — §3) |
| **Sales** | salesOrders, salesCustomers, centralFulfilment, centralWarehouse | **0** |
| **People & scheduling** | staff, scheduleV2, scheduleShifts, scheduleStaff, scheduleRoles, scheduleDepartments, scheduleTimeOff, weeklyManpower, sevenShifts, employeeProfiles, employeePhotos, onboarding, teams | **0** |
| **Finance** | finance, statements | **0** |
| **Fleet & equipment** | fleet, fleetAlerts, equipment, maintenance, containers | **0** |
| **Platform** | auth, users, rolePermissions, systemConfig, systemUpdate, navConfig, notifications, backup, realtimePoll, news | **0** |

**Two domains matter more than the rest and are both invisible to her**, because they are what
`CLAUDE.md` names as the live business problems:

- **`priceBook` / `ingredientCosting`** — the Pricing Project (~90 unpriced ingredients)
- **`recipes` / `prepCosting`** — the recipe costing blocker (~120 recipes at default yield 1.00)

She cannot read either. Any question about cost or price today is answered from nothing.

---

## 2. ENTITIES AND RELATIONSHIPS

### Entities she can see (6)

`INVENTORY_ITEM`, `SUPPLIER`, `DAILY_COUNT`, `ORDER_SUGGESTION`, `PURCHASE_ORDER`, `INVOICE`.

### Relationships — measured, not inferred

| edge | state |
|---|---|
| `orderPlanning.ingredient_id` → `inventory.id` | **live**, 3/3 populated |
| `orderPlanning.supplier_id` → `suppliers.id` | **live**, 3/3 populated |
| `purchaseOrders.supplierId` → `suppliers.id` | **live**, 3/3 populated |
| `dailyCounts.items[].ingredientId` → `inventory.id` | **live**, present on every item |
| `invoices.supplierId` → `suppliers.id` | **DEAD** — null in every sampled row |
| `invoices.lineItems[]` → any ingredient | **ABSENT** — line items carry `rawDescription` text only |
| `purchaseOrders.items[]` → any ingredient | **not inspected** |

### The structural facts that follow

1. **The graph is directed and `inventory` and `suppliers` are SINKS** — no outbound references
   at all. Three of six nodes point *into* them; nothing points out.
2. **Nothing links an invoice to an ingredient.** `lineItems[].rawDescription` is free text. This
   is the same gap the Invoice Intake feature exists to close (`invoice_line_alias`), and that
   table is **not exposed to the AI at all**.
3. **No price relationship is reachable.** `orderPlanning.latest_price` was null in every sampled
   row, and `priceBook` has no AI endpoint. **A costing question has no evidence path.**

---

## 3. AVAILABLE READ / WRITE CAPABILITIES

The AI-facing surface, complete:

| router | mount | routes | 香香 uses |
|---|---|---|---|
| `aiIntegration` | `/api/v1/ai` | 6 GET + **3 POST draft** | 6 GET |
| `aiIngredients` | `/api/v1/ai/ingredients` | 2 GET + **2 POST** | **none** |
| `aiMemory` | `/api/v1/ai/memory` | 2 GET + **POST, PATCH ×2, DELETE** | **none** |
| `aiAutonomy` | `/api/v1/ai-autonomy` | 2 GET + **PUT** | **none** |

**Writes that exist and are unknown to her capability map:**

```
POST   /api/v1/ai/invoices/draft
POST   /api/v1/ai/purchase-orders/draft
POST   /api/v1/ai/prep-tasks/draft
POST   /api/v1/ai/ingredients/draft
POST   /api/v1/ai/ingredients/:id/update-proposal
POST   /api/v1/ai/memory          PATCH /:id   PATCH /:id/review   DELETE /:id
PUT    /api/v1/ai-autonomy
```

**This is not a vulnerability and should not be read as one.** Her read adapter is structurally
incapable of reaching them — `const METHOD = 'GET'`, one constant, no method parameter — and
`PUT /ai-autonomy` calls `requireOwner` inside its handler.

> **I nearly reported that PUT as unauthenticated** because `requireAiAuth` is absent from the
> route signature. It is gated inside the body. That would have been a false finding from a
> route's *shape* — name-based inference for the fourth time this week (HR-56), and the first
> where the wrong conclusion would have been an alarm rather than a gap.

**What it does mean:** the drafting capability the business already built for an AI is entirely
unused, and no document connects it to her. If a write path is ever wanted, it exists and it is
already `draft`-shaped — which fits Proposal/Approval rather than bypassing it.

---

## 4. MISSING RELATIONSHIPS

Ranked by what they block:

1. **invoice → ingredient.** Blocks every 「what did this cost us / has the price moved」 question.
   The mapping exists in `invoice_line_alias` inside the invoice-intake feature and is not
   exposed.
2. **ingredient → price.** No `priceBook` endpoint; `latest_price` arrives null. Blocks costing
   entirely.
3. **invoice → supplier.** The field exists and is dead (§2).
4. **ingredient → recipe.** No recipe endpoint, so 「what do we use this in」 is unanswerable.
5. **stocktake → variance.** Both sides exist (`dailyCounts.items[].countedQty`,
   `inventory.currentStock`) with a live join key — **this is the one genuinely reachable
   multi-step relationship today**, and the reason it is the right first enquiry case.

---

## 5. STALE ARCHITECTURE DOCUMENTATION

| artefact | state |
|---|---|
| `aiSwagger.json` | documents **10 paths — 6 GET + 4 POST**. Accurate for `aiIntegration` and `ingredients/draft`. **Omits `aiMemory` (6 routes), `aiAutonomy` (3), and `aiIngredients` GETs.** So the AI's own published contract covers 10 of 24 routes. |
| `aromaSystemRead.js` reader | knows 6. Its `ALLOWED_QUERY` declares 6 parameters **the server accepts none of** (DEFECT-007). |
| aroma-system `CLAUDE.md` | describes the Invoice Intake build as current. **Does not mention the AI integration surface at all** — not the endpoints, not the key, not the drafts. |
| `SCOPE_OF` / `METRICS_OF` etc. | 6 hand-written tables, **no completeness check**; `DERIVATIONS_OF` and `FIELD_LABELS_OF` are missing four endpoints each, and a missing key is indistinguishable from 「nothing to declare」. |

> **The most reliable document in this audit is the swagger file, and it is 42% complete.**

---

## 6. GAPS RELEVANT TO FUTURE REASONING

Stated as what a reasoning layer would get wrong, not as a wish list:

1. **Cost and price are unreachable.** The commonest owner question class — 「係咪貴咗」 — has no
   evidence path, and nothing in the system says so. She would answer from memory or decline for
   the wrong reason.
2. **Two of six entities are graph sinks**, so reference-following cannot expand from the two most
   queried nodes (see `DESIGN-TWO-PLANNERS.md`).
3. **Three of six endpoints carry hidden windows**, so any multi-step read mixing them silently
   compares a 30-day slice against an unfiltered table. **This is exactly why the HOLD is right:
   a reasoning layer would compute a variance between two differently-scoped sets and present it
   as a finding.**
4. **No entity has a price, a cost or a recipe link**, so nothing can be reasoned about
   financially even with perfect multi-step machinery.
5. **The reader's map has no notion of write capability**, so it cannot even say 「I could draft a
   PO for that, but I will not without approval」 — it does not know the draft route exists.

---

## 7. WHAT THIS AUDIT DID NOT DO

- **No writes, no deployment, no restart.** Read-only source inspection plus the six GETs
  already captured.
- **`purchaseOrders.items[]` and `invoices.lineItems[]` internals were not inspected** beyond
  their presence.
- **The other 109 route files were classified by NAME**, not by reading them. Given HR-56 that is
  a weak method and is flagged as such: the domain table in §1 is a map of what things are called,
  not a verified account of what they do.
- **No database was queried.** Every count here comes from an API response or a source file.
