import { getRequestContext } from '../lib/requestContext.js'

/**
 * Error responses must never leak PHI. Prisma errors in particular embed the
 * offending field values — a unique-constraint failure will happily quote a
 * resident's email back at you — so nothing from the error object reaches the
 * client except a status and a generic message.
 */
export function errorHandler(err, _req, res, _next) {
  const { requestId } = getRequestContext()
  const status = err.status ?? 500

  if (status >= 500) {
    // Log the message and stack, never the request body or Prisma meta.
    console.error('REQUEST FAILED', { requestId, status, message: err.message, stack: err.stack })
  }

  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    requestId,
  })
}

export function notFound(_req, res) {
  const { requestId } = getRequestContext()
  res.status(404).json({ error: 'Not found', requestId })
}
