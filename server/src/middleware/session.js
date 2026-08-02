import { SESSION_COOKIE, resolveSession } from '../auth/sessions.js'
import { setActor } from '../lib/requestContext.js'

/**
 * Attaches req.session when the cookie names a live session.
 *
 * This does NOT reject anonymous requests — requireAuth does that. Splitting
 * them keeps "who is this" separate from "are they allowed", so an endpoint can
 * never accidentally be authorized by the mere presence of a cookie.
 */
export async function sessionMiddleware(req, _res, next) {
  try {
    const record = await resolveSession(req.cookies?.[SESSION_COOKIE])
    if (record) {
      req.session = {
        id: record.id,
        userId: record.userId,
        role: record.user.role,
        residentId: record.user.residentId ?? null,
        fullName: record.user.fullName,
      }
      // Makes the actor available to the audit extension without threading it
      // through every service call.
      setActor({ actorId: record.userId, actorRole: record.user.role })
    }
    next()
  } catch (err) {
    next(err)
  }
}
