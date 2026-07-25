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
const { createDriveReadAdapter } = require('./adapters/driveRead')
const { createGmailReadAdapter } = require('./adapters/gmailRead')
const { createCalendarReadAdapter } = require('./adapters/calendarRead')

const ALL_SOURCES = Object.freeze(['drive', 'gmail', 'calendar', 'github'])

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

module.exports = { ALL_SOURCES, enabledSources, createLiveReadConnector }
