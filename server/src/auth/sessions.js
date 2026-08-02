import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { prisma } from '../db/client.js'

export const SESSION_COOKIE = 'sl_session'

const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES ?? 20)
const ABSOLUTE_HOURS = Number(process.env.SESSION_ABSOLUTE_HOURS ?? 12)

/** Only the hash is stored, so a database leak yields no usable sessions. */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function minutesFromNow(m) {
  return new Date(Date.now() + m * 60_000)
}

export async function createSession({ userId, ipAddress, userAgent }) {
  const token = randomBytes(32).toString('base64url')

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      idleExpiresAt: minutesFromNow(IDLE_MINUTES),
      absoluteExpiresAt: minutesFromNow(ABSOLUTE_HOURS * 60),
      ipAddress,
      userAgent,
    },
  })

  return token
}

/**
 * Returns the live session with its user, or null. Also slides the idle window.
 * Expiry is evaluated here, on the server — never trusted from the client.
 */
export async function resolveSession(token) {
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!session) return null

  const now = new Date()
  if (session.revokedAt) return null
  if (session.idleExpiresAt <= now) return null
  if (session.absoluteExpiresAt <= now) return null
  if (!session.user?.isActive || session.user.deletedAt) return null

  // Slide the idle window, but never past the absolute ceiling.
  const nextIdle = minutesFromNow(IDLE_MINUTES)
  await prisma.session.update({
    where: { id: session.id },
    data: {
      idleExpiresAt: nextIdle > session.absoluteExpiresAt ? session.absoluteExpiresAt : nextIdle,
    },
  })

  return session
}

export async function revokeSession(token, reason = 'signed out') {
  if (!token) return
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
}

/** Used when a staff member is deactivated — kills every device at once. */
export async function revokeAllForUser(userId, reason) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // No maxAge on purpose: this is a session cookie, so closing the browser
    // drops it. Real lifetime is enforced server-side regardless.
  }
}

/** Constant-time compare, for anywhere we compare secrets directly. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
