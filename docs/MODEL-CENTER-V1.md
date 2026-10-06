# Central models and capabilities, v1

Owner page: `/model-center`, linked from both settings entrances. Page and APIs
require the existing Owner credential; mutations additionally require exact
same-origin loopback requests. Reading account metadata never starts inference.

## Brain selection

- Central default is saved in `model-center.json` under the configured data root.
  Initial values preserve the existing Claude Sonnet / Medium default.
- A topic or general conversation explicitly follows central, or stores its own
  model and effort. Topic settings apply across its linked conversations; general
  conversation settings use its conversation ID. Topic membership comes from the
  server's existing workspace store, not from a model or browser declaration.
- Following scopes resolve central on the next accepted message. Custom scopes
  retain their values. Accepted text, image and development-dialogue requests
  capture model and effort once, before asynchronous work starts.
- Provider menus are separate. Model availability and supported effort come from
  the account catalogue. Unsupported effort or unavailable models are refused;
  failed reads never substitute an API, GPT, Claude or paid fallback.
- Browser controls await durable saving and refresh metadata before sending.
  Changes persist across reload/login. The legacy shared browser preference is
  retained but is not inferred as a selection for every independent topic.
- Saves use optimistic per-scope revisions, atomic replacement and an audit entry
  carrying Owner attribution, before/after values and time. Corrupt data is
  reported unavailable, never erased or repaired by guessing. Existing conversation
  history, topic follow-ups, decisions and credentials remain in their own stores.

## Other roles

The same center lists current eyes, development workers, code/visual review,
mail analysis, memory indexing and routing configuration. These are an inventory,
not unrestricted editable worker models. Partial integration is stated explicitly.
Each worker keeps its existing governance, source verification and execution
contract. Changing the brain cannot replace those contracts or authorize work.

No automatic API or cross-provider credit fallback was added. Provider-side
subscription limits and overage settings remain controlled by the account.

## Acceptance

`src/modelCenter/service.test.js` checks persistence, independent overrides,
captured selections, stale saves, unavailable metadata and corrupt-data retention.
`routes.test.js` checks Origin and payload closure. `intake.test.js` drives real
HTTP text/image/dialogue routes with inert provider spies, including a held request
while central changes. Existing architecture acceptance checks Owner gating.
`browser.test.js` uses actual Edge rendering at desktop/mobile widths in Chinese
and English, temporary stores and intercepted responses: central saving, separate
topic choices, central changes, exact outgoing selection, reload and overflow.
It performs no provider inference or live operational write.
