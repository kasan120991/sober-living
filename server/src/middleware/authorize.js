import { STAFF_ROLE } from '../domain/constants.js'

/**
 * The single authorization util. CLAUDE.md is explicit that this is the app's
 * most important privacy boundary — residents must never be able to enumerate
 * other residents — so it lives in one place and is applied per route rather
 * than copy-pasted around.
 *
 * Postgres row-level security is the second line of defence behind this.
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** No route is public by default. Public routes must opt out explicitly. */
export function requireAuth(req, _res, next) {
  if (!req.session?.userId) return next(new HttpError(401, 'Authentication required'))
  next()
}

export function requireRole(...roles) {
  const allowed = new Set(roles)
  return (req, _res, next) => {
    if (!req.session?.userId) return next(new HttpError(401, 'Authentication required'))
    if (!allowed.has(req.session.role)) return next(new HttpError(403, 'Not permitted'))
    next()
  }
}

/** Staff-only: any role except RESIDENT. */
export const requireStaff = requireRole(
  STAFF_ROLE.ADMIN,
  STAFF_ROLE.HOUSE_MANAGER,
  STAFF_ROLE.STAFF,
)

/**
 * Guards resident-scoped routes. A RESIDENT may only ever address their own
 * record; staff may address any. Returns the resident id the caller is allowed
 * to act on, so callers cannot accidentally trust an unchecked param.
 */
export function resolveResidentScope(req, requestedResidentId) {
  const { role, residentId } = req.session ?? {}

  if (role === STAFF_ROLE.RESIDENT) {
    if (!residentId) throw new HttpError(403, 'Not permitted')
    // Silently scoping to self would let a resident probe for existence by
    // watching which ids return data. Refuse instead.
    if (requestedResidentId && requestedResidentId !== residentId) {
      throw new HttpError(404, 'Not found')
    }
    return residentId
  }

  if (!requestedResidentId) throw new HttpError(400, 'residentId is required')
  return requestedResidentId
}
