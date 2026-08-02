import { actorFromSession, runWithDbActor } from '../lib/dbContext.js'

/**
 * Opens the database actor context for the request.
 *
 * Must run AFTER sessionMiddleware — it derives what the database is allowed to
 * show from the verified session, not from anything the client sent. An
 * unauthenticated request gets no context at all, which under fail-closed
 * policies means no resident rows, which is the correct answer.
 */
export function dbActorMiddleware(req, _res, next) {
  const actor = actorFromSession(req.session)
  if (!actor) return next()
  runWithDbActor(actor, () => next())
}
