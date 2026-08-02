import { HttpError } from '../middleware/authorize.js'

/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware. Express 5 forwards rejections itself, but being explicit keeps
 * every route reading the same way.
 */
export function handler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

/**
 * Validates a request body and throws a 400 on failure.
 *
 * The message names the offending fields but never echoes their values — a
 * validation error on a resident's date of birth must not put that value in a
 * response or a log. See CLAUDE.md.
 */
export function parseBody(schema, body) {
  const result = schema.safeParse(body)
  if (result.success) return result.data

  const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || 'body'))]
  throw new HttpError(400, `Invalid ${fields.join(', ')}`)
}

/** Postgres/Prisma error codes we translate into meaningful HTTP responses. */
export const PRISMA = {
  UNIQUE_VIOLATION: 'P2002',
  FK_VIOLATION: 'P2003',
  NOT_FOUND: 'P2025',
}
