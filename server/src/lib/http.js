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
/**
 * Whether a Prisma error is a unique violation on a particular column.
 *
 * Prisma 7 with the driver adapter STOPPED populating `meta.target` — the
 * constraint's name now lives in
 * `meta.driverAdapterError.cause.originalMessage`. Code reading `meta.target`
 * silently stopped matching, which is how `postEntry`'s "that payment has
 * already been recorded" 409 quietly became a 500. Both shapes are checked
 * here so one place knows about the change.
 */
export function isUniqueViolationOn(err, column) {
  if (err?.code !== PRISMA.UNIQUE_VIOLATION) return false
  const target = String(err?.meta?.target ?? '')
  const original = String(err?.meta?.driverAdapterError?.cause?.originalMessage ?? '')
  return target.includes(column) || original.includes(column)
}

export const PRISMA = {
  UNIQUE_VIOLATION: 'P2002',
  FK_VIOLATION: 'P2003',
  NOT_FOUND: 'P2025',
}
