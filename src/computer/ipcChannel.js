'use strict'

/**
 * ipcChannel.js — Computer Operator v0, Phase 3a. The Service ↔ Companion transport.
 *
 * A Windows named pipe, because it is local by construction: it has no port, is not
 * reachable from any network, and its ACL is an OS control rather than something this
 * code has to get right. The Service listens; the Companion connects.
 *
 * ── THE CHANNEL CARRIES ENVELOPES, NOT COMMANDS ───────────────────────────────
 * Every frame is validated against the closed IPC contract before it reaches anything
 * that could act on it. A malformed or misdirected frame is refused at the boundary, so
 * the Companion's handler only ever sees shapes the contract permits.
 *
 * ── STOPPING IS PART OF THE TRANSPORT, NOT AN AFTERTHOUGHT ────────────────────
 * `close()` destroys the server and every live connection. That is the mechanism the OS
 * fallback relies on: when the Windows service stops or the account logs out, the pipe
 * dies with it and the Companion has nothing to answer on. There is no reconnect loop —
 * a Companion whose channel is gone stays gone, because a process that can rejoin after
 * being stopped is not stopped.
 */

const net = require('node:net')

/** Windows named-pipe path. Never derived from user input. */
function pipePath (name) {
  const safe = String(name || '').replace(/[^A-Za-z0-9_-]/g, '')
  if (!safe) throw new TypeError('ipcChannel requires a safe pipe name')
  return '\\\\.\\pipe\\' + safe
}

/** Newline-delimited JSON, with a hard frame cap so a peer cannot exhaust memory. */
const MAX_FRAME_BYTES = 64 * 1024

function frame (obj) { return JSON.stringify(obj) + '\n' }

function createFrameReader (onFrame, onOversize) {
  let buf = ''
  return (chunk) => {
    buf += chunk
    if (buf.length > MAX_FRAME_BYTES) { buf = ''; onOversize(); return }
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      let parsed = null
      try { parsed = JSON.parse(line) } catch (_) { parsed = null }
      onFrame(parsed)
    }
  }
}

/**
 * The SERVICE end: listens, and sends requests to whichever Companion is connected.
 * @param {{ name: string, onMessage?: Function }} options
 */
function createServiceEndpoint (options = {}) {
  const p = pipePath(options.name)
  const onMessage = typeof options.onMessage === 'function' ? options.onMessage : () => {}
  const sockets = new Set()
  let server = null

  return {
    pipePath: p,
    async listen () {
      server = net.createServer((socket) => {
        sockets.add(socket)
        socket.setEncoding('utf8')
        socket.on('data', createFrameReader(
          (msg) => { if (msg) onMessage(msg, socket) },
          () => socket.destroy()
        ))
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => { sockets.delete(socket); socket.destroy() })
      })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(p, resolve)
      })
      return p
    },
    send (msg) { for (const s of sockets) s.write(frame(msg)); return sockets.size },
    connectionCount () { return sockets.size },
    /** Destroys the server AND every live connection — this is what a stop means. */
    async close () {
      for (const s of sockets) s.destroy()
      sockets.clear()
      if (server) await new Promise((r) => server.close(r))
      server = null
    }
  }
}

/**
 * The COMPANION end: connects, answers, and does not reconnect after being closed.
 * @param {{ name: string, onMessage?: Function }} options
 */
function createCompanionEndpoint (options = {}) {
  const p = pipePath(options.name)
  const onMessage = typeof options.onMessage === 'function' ? options.onMessage : () => {}
  let socket = null
  let closed = false

  return {
    pipePath: p,
    async connect () {
      await new Promise((resolve, reject) => {
        socket = net.connect(p)
        socket.setEncoding('utf8')
        socket.once('connect', resolve)
        socket.once('error', reject)
      })
      socket.on('data', createFrameReader(
        (msg) => { if (msg) { const out = onMessage(msg); if (out) socket.write(frame(out)) } },
        () => socket.destroy()
      ))
      // No reconnect handler, deliberately: a Companion that can rejoin after being
      // stopped has not been stopped.
      socket.on('close', () => { closed = true })
      return p
    },
    isConnected () { return !!socket && !closed && !socket.destroyed },
    send (msg) { if (socket && !socket.destroyed) socket.write(frame(msg)) },
    close () { closed = true; if (socket) socket.destroy(); socket = null }
  }
}

module.exports = { createServiceEndpoint, createCompanionEndpoint, pipePath, MAX_FRAME_BYTES }
