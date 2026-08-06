import { Server } from 'socket.io'
// cookie v2 renamed the v0 API: parseCookie, not parse.
import { parseCookie } from 'cookie'

import { SESSION_COOKIE, resolveSession } from '../auth/sessions.js'
import { STAFF_ROLE } from '../domain/constants.js'
import { corsOrigins } from './origins.js'

/**
 * Realtime is an INVALIDATION SIGNAL, not a data channel.
 *
 * A socket is a fan-out and RLS does not apply to it — every subscriber gets
 * whatever the server pushes. So the server pushes nothing: one event,
 * `changed`, whose payload is a timestamp and nothing else. No ids, no names,
 * no entity types. Clients respond by refetching what they already show over
 * the authenticated HTTP API, where RLS, RBAC and the audit log apply to every
 * byte, per subscriber, exactly as they do today.
 *
 * That contract is a hard rule, not a default: anyone adding a payload field
 * beyond `at` is turning this into a data channel, and owes the fan-out
 * warning in CLAUDE.md module 12 a full design — per-subscriber authorization,
 * storage, and who-receives-what — not an extra property on an emit.
 *
 * Because the events carry nothing, a socket that outlives its session (a
 * session revoked by scripts/create-user.js or a reseed, both of which run in
 * another process) leaks nothing: it receives timestamps until it next
 * reconnects, and the reconnect handshake refuses it. In-process revocation —
 * logout — disconnects the session's sockets immediately.
 *
 * Idle expiry slides on the HTTP refetches, never on socket traffic: a
 * connected but untouched device still times out, which is the point of the
 * timeout on a shared house phone.
 */
export const CHANGED_EVENT = 'changed'

/** One emit per window, however many writes land inside it. */
export const COALESCE_MS = 75

// The three roles requireStaff accepts. Deliberately an allowlist rather than
// `!== RESIDENT`: server STAFF_ROLE includes RESIDENT, and a future fourth
// role should be excluded until someone decides otherwise.
const SOCKET_ROLES = new Set([STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER, STAFF_ROLE.STAFF])

let io = null
let pending = null

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins(), credentials: true },
  })

  io.use(async (socket, next) => {
    try {
      // resolveSession slides the idle expiry (a write), so it runs exactly
      // once — at the handshake — and never per event.
      const token = parseCookie(socket.handshake.headers.cookie ?? '')[SESSION_COOKIE]
      const session = await resolveSession(token)
      if (!session || !SOCKET_ROLES.has(session.user.role)) {
        return next(new Error('unauthorized'))
      }
      socket.data.sessionId = session.id
      // A room per session, so logout can drop exactly that device's sockets.
      socket.join(`session:${session.id}`)
      next()
    } catch (err) {
      next(err)
    }
  })

  return io
}

/**
 * Signal that something changed. Safe to call when realtime was never
 * initialized — verify scripts and tests use createApp() without a socket
 * server, and broadcasting into the void is a no-op, not an error.
 */
export function broadcastChanged() {
  if (!io || pending) return
  pending = setTimeout(() => {
    pending = null
    io.emit(CHANGED_EVENT, { at: new Date().toISOString() })
  }, COALESCE_MS)
}

/** Drops every socket the session has open. Used at logout. */
export function disconnectSession(sessionId) {
  if (io) io.in(`session:${sessionId}`).disconnectSockets(true)
}

/** Close before httpServer.close() — held connections otherwise hang it. */
export function closeRealtime() {
  clearTimeout(pending)
  pending = null
  if (!io) return Promise.resolve()
  const closing = io.close()
  io = null
  return closing
}
