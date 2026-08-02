import { AsyncLocalStorage } from 'node:async_hooks'
import { STAFF_ROLE } from '../domain/constants.js'

/**
 * Who the database thinks is asking.
 *
 * Row-level security policies read `app.actor_kind` and `app.resident_id`. They
 * are FAIL-CLOSED: with nothing set, every policy predicate is false and the
 * query returns no rows. That is deliberate — forgetting to set context should
 * lose you data, never leak it.
 *
 * Kept separate from lib/requestContext.js on purpose. That one carries who is
 * making an HTTP request for the audit log; this one carries what the database
 * is permitted to show, and it must also work in scripts that have no request.
 */
const storage = new AsyncLocalStorage()

export const ACTOR = Object.freeze({
  STAFF: 'staff',
  RESIDENT: 'resident',
})

/** @returns {{kind: string, residentId: string|null}|null} */
export function getDbActor() {
  return storage.getStore() ?? null
}

export function runWithDbActor(actor, fn) {
  return storage.run(actor, fn)
}

/**
 * Staff context for scripts — seeds, verification, migrations-adjacent tooling.
 * Named "system" rather than "staff" so its use is obvious in a diff: anything
 * calling this is deliberately outside a request.
 */
export function runAsSystem(fn) {
  return runWithDbActor({ kind: ACTOR.STAFF, residentId: null }, fn)
}

/** Derives the database actor from a verified session. */
export function actorFromSession(session) {
  if (!session) return null
  return session.role === STAFF_ROLE.RESIDENT
    ? { kind: ACTOR.RESIDENT, residentId: session.residentId ?? null }
    : { kind: ACTOR.STAFF, residentId: null }
}
