'use strict'

/**
 * broker.js — Phase 2 Gate 1 slice 6 (Model 2). A backend-side named-pipe server
 * that fronts the projection endpoint for the MCP connector. The MCP holds NO
 * secret; the BROKER holds BACKEND_READ_IDENTITY and presents it to project(). The
 * pipe (sub-step 3 ACL, slice 6 admin) authenticates the mcp_svc SID; the broker
 * takes principal/app/window/status/correlationId from the request but ALWAYS
 * supplies presentedReadIdentity from its OWN held value — never from the payload.
 *
 * Wire protocol: one newline-delimited JSON request per connection →
 * one newline-delimited JSON response (the project() result). Fail-closed: a
 * malformed request or a project() throw yields a fixed-code error, never data.
 * The held identity is never written to the response or logs.
 */

const net = require('node:net')

function createBroker ({ projectionEndpoint, backendReadIdentity } = {}) {
  if (!projectionEndpoint || typeof projectionEndpoint.project !== 'function') throw new TypeError('createBroker requires projectionEndpoint.project')
  if (typeof backendReadIdentity !== 'string' || backendReadIdentity === '') throw new TypeError('createBroker requires backendReadIdentity (held by the broker; Model 2)')

  /** Turn a validated pipe request into a project() response. presentedReadIdentity
   *  ALWAYS comes from the broker's held secret, never from the request payload. */
  function handleRequest (req) {
    if (!req || typeof req !== 'object') return { ok: false, code: 'BAD_REQUEST' }
    const status = (req.status === 'succeeded' || req.status === 'failed') ? req.status : undefined
    try {
      return projectionEndpoint.project({
        presentedReadIdentity: backendReadIdentity, // from broker (Model 2), NOT req
        principal: req.principal,
        app: req.app,
        window: req.window,
        filters: { status },
        correlationId: req.correlationId
      })
    } catch (_) {
      return { ok: false, code: 'SOURCE_ERROR' }
    }
  }

  let server = null

  function start (pipePath) {
    server = net.createServer((socket) => {
      let buf = ''
      socket.on('data', (d) => {
        buf += d.toString('utf8')
        const nl = buf.indexOf('\n')
        if (nl === -1) return
        let req = null
        try { req = JSON.parse(buf.slice(0, nl)) } catch (_) { req = null }
        const resp = req == null ? { ok: false, code: 'BAD_REQUEST' } : handleRequest(req)
        socket.end(JSON.stringify(resp) + '\n')
      })
      socket.on('error', () => { try { socket.destroy() } catch (_) {} })
    })
    return new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipePath, () => resolve()) })
  }

  function stop () { return new Promise((resolve) => { if (!server) return resolve(); server.close(() => resolve()) }) }

  return { handleRequest, start, stop }
}

module.exports = { createBroker }
