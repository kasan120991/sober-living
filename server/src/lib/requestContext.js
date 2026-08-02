import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/**
 * Carries who is making the current request down to the data layer.
 *
 * The audit extension in db/client.js needs the actor, IP and request id, but
 * threading those through every service call as parameters is exactly the kind
 * of discipline that gets skipped in one place. AsyncLocalStorage makes the
 * context ambient instead, so an audit entry cannot be written anonymously by
 * accident.
 */
const storage = new AsyncLocalStorage()

/** @returns {{actorId: string|null, actorRole: string|null, ipAddress: string|null, userAgent: string|null, requestId: string}} */
export function getRequestContext() {
  return (
    storage.getStore() ?? {
      actorId: null,
      actorRole: null,
      ipAddress: null,
      userAgent: null,
      requestId: 'no-request-context',
    }
  )
}

export function runWithRequestContext(context, fn) {
  return storage.run(context, fn)
}

/** Express middleware — opens the context for the lifetime of the request. */
export function requestContextMiddleware(req, res, next) {
  const requestId = req.get('x-request-id') ?? randomUUID()
  res.set('x-request-id', requestId)

  runWithRequestContext(
    {
      // Populated by the auth middleware once it has verified the session.
      actorId: null,
      actorRole: null,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId,
    },
    () => next(),
  )
}

/** Called by the auth middleware after a session is verified. */
export function setActor({ actorId, actorRole }) {
  const store = storage.getStore()
  if (!store) return
  store.actorId = actorId
  store.actorRole = actorRole
}
