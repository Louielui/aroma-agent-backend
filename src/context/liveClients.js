'use strict'

/**
 * liveClients.js — builds the live read-only connector: for each source whose flag is
 * 'on', it lazily constructs the real client and registers that source's READ adapter
 * on ONE shared readConnector.
 *
 * PER-SOURCE and FAIL-SOFT by construction:
 *   - a source whose flag is off is never built;
 *   - a source whose credentials are missing/broken is simply NOT registered (the
 *     connector then answers trust:'unavailable' for it);
 *   - a failure in one source NEVER prevents the others, and NEVER throws — so this
 *     can never block startup. GitHub absent → Google sources still work, and vice
 *     versa.
 *
 * Everything external is injectable (googleAuthMod / githubAdapterFactory / connector
 * factory), so tests build the whole thing with fakes and never touch a real API.
 * No credential value is ever logged or returned.
 */

const { createReadConnector } = require('./readConnector')
const { readAccessEnabled, resolveFlag } = require('./flags')
const { createGithubReadAdapter } = require('./adapters/githubRead')
const { createRecordReadAdapter } = require('./adapters/recordRead') // the development record, derived from THIS build's docs/
const { createDriveReadAdapter } = require('./adapters/driveRead')
const { createGmailReadAdapter } = require('./adapters/gmailRead')
const { createCalendarReadAdapter } = require('./adapters/calendarRead')
const { createAromaSystemReadAdapter, KEY_ENV: AROMA_KEY_ENV } = require('./adapters/aromaSystemRead')
const { createPublicKnowledgeReadAdapter } = require('./adapters/publicKnowledgeRead')
const { createOpenAIWebSearchProvider } = require('./providers/openaiWebSearchProvider')
const { a4SemanticRoutingEnabled } = require('../intake/a4Contract')

// development_record is LOCAL: it is derived from this build's own docs/ directory, so it
// needs no token, no scope and no network. It is listed here because the read layer routes
// by source key, not because it is an external connector.
//
// ⛔ `public_knowledge` IS IN THE ARCHITECTURE AND STILL OFF. A4-2B deliberately kept it out of
// this list so nothing could construct it at all; that made it unreachable rather than
// governed. It is now a first-class source subject to the ordinary rules — and to two extra
// ones below — so activation is a decision someone makes, not a line someone has to add.
const PUBLIC_KEY_ENV = 'OPENAI_API_KEY'
const ALL_SOURCES = Object.freeze(['drive', 'gmail', 'calendar', 'github', 'aroma_system', 'development_record', 'public_knowledge'])

/** Sources whose master+per-source flags are both exactly 'on'. */
function enabledSources (env = process.env) {
  return ALL_SOURCES.filter((s) => readAccessEnabled(env, s))
}

/**
 * Build a connector with only the enabled+buildable sources registered.
 * @returns {{ connector, registered: string[], skipped: {source,reason}[] }}
 */
function createLiveReadConnector (options = {}) {
  const env = options.env || process.env
  const googleAuthMod = options.googleAuthMod || require('./googleAuth')
  const connector = options.connector || createReadConnector({ env, caps: options.caps, clock: options.clock })
  const registered = []
  const skipped = []

  // Master gate: nothing is built at all when READ_ACCESS is not exactly 'on'.
  if (resolveFlag(env, 'READ_ACCESS') !== 'on') {
    return { connector, registered, skipped: ALL_SOURCES.map((s) => ({ source: s, reason: 'READ_ACCESS off' })) }
  }

  const googleSvc = (name, version) => (options.googleServiceFn
    ? options.googleServiceFn(name, version)
    : googleAuthMod.service(name, version))

  const builders = {
    drive: () => createDriveReadAdapter({ client: googleSvc('drive', 'v3'), clock: options.clock }),
    gmail: () => createGmailReadAdapter({ client: googleSvc('gmail', 'v1'), clock: options.clock }),
    calendar: () => createCalendarReadAdapter({ client: googleSvc('calendar', 'v3'), clock: options.clock }),
    github: () => {
      const token = env.GITHUB_READ_TOKEN
      if (!token) throw new Error('GITHUB_READ_TOKEN not set') // reason only — never the value
      return options.githubAdapterFactory
        ? options.githubAdapterFactory({ token, clock: options.clock })
        : createGithubReadAdapter({ token, clock: options.clock })
    },
    aroma_system: () => {
      // Same shape as github: the reason names the MISSING VARIABLE, never a value. With
      // no key the source is simply not registered — it reports unavailable when asked,
      // startup is unaffected, and the other four sources do not notice.
      const key = env[AROMA_KEY_ENV]
      if (!key) throw new Error(AROMA_KEY_ENV + ' not set')
      return options.aromaSystemAdapterFactory
        ? options.aromaSystemAdapterFactory({ env, clock: options.clock })
        : createAromaSystemReadAdapter({ env, clock: options.clock })
    },
    /**
     * ⛔ THE OUTSIDE WORLD, BEHIND FOUR CONDITIONS.
     *
     * Master READ_ACCESS and its own CONTEXT_PUBLIC_KNOWLEDGE flag are checked by the loop
     * below, like every other source. Two more are checked here, because this is the only
     * source with an EGRESS side — reading it sends words out of the building:
     *
     *   · an API key must exist. The reason names the MISSING VARIABLE, never a value.
     *   · A4 must be on. The Owner-only Public Query Egress Planner, the source-intent
     *     resolver and the world obligations all live in A4; without them a public read has
     *     no authority deciding what may leave. Registering this source outside A4 would be
     *     an egress path with its governance switched off.
     *
     * ⛔ AND NO SECOND VENDOR. If this provider cannot be built the source is simply absent —
     * there is no alternative search provider to fall back to, because a silent vendor swap
     * would move the Owner's words to a company he never agreed to.
     */
    public_knowledge: () => {
      const key = env[PUBLIC_KEY_ENV]
      if (!key) throw new Error(PUBLIC_KEY_ENV + ' not set')
      if (!a4SemanticRoutingEnabled(env)) throw new Error('A4_KNOWLEDGE_ROUTING off')
      const provider = options.publicSearchProviderFactory
        ? options.publicSearchProviderFactory({ env, apiKey: key })
        : createOpenAIWebSearchProvider({ apiKey: key })
      return createPublicKnowledgeReadAdapter({ provider, clock: options.clock })
    }
  }

  for (const source of ALL_SOURCES) {
    if (!readAccessEnabled(env, source)) { skipped.push({ source, reason: 'flag off' }); continue }
    try {
      connector.register(builders[source]())
      registered.push(source)
    } catch (e) {
      // Fail-soft: not registered → the connector reports it unavailable. Never throws.
      skipped.push({ source, reason: (e && e.message) || String(e) })
    }
  }

  return { connector, registered, skipped }
}

module.exports = { ALL_SOURCES, enabledSources, createLiveReadConnector, PUBLIC_KEY_ENV }
