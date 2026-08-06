import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'

import { prisma } from '../db/client.js'
import { verifyPassword } from '../auth/passwords.js'
import {
  SESSION_COOKIE,
  createSession,
  revokeSession,
  sessionCookieOptions,
} from '../auth/sessions.js'
import { HttpError, requireAuth } from '../middleware/authorize.js'
import { getRequestContext } from '../lib/requestContext.js'
import { disconnectSession } from '../lib/realtime.js'
import { AUDIT_ACTION } from '../domain/constants.js'

const router = Router()

const MAX_FAILED = 8
const LOCKOUT_MINUTES = 15

/**
 * ONE message for every failure mode — bad email, bad password, locked, or
 * deactivated.
 *
 * This is not generic politeness. A distinct "no account with that email" would
 * turn the login form into an oracle for checking whether a specific named
 * person is in a substance use treatment program. Under 42 CFR Part 2 that is
 * the disclosure we are most obliged to prevent.
 */
const GENERIC_FAILURE = "That email and password don't match."

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again shortly.' },
})

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(1024),
})

async function auditLogin(action, userId) {
  const ctx = getRequestContext()
  await prisma.auditLog.create({
    data: {
      actorId: userId ?? null,
      action,
      entity: 'User',
      entityId: userId ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    },
  })
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, GENERIC_FAILURE)
    const { email, password } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    const now = new Date()

    // Verify even when the user is missing, against a throwaway hash, so the
    // response time does not reveal whether the account exists.
    const storedHash =
      user?.passwordHash ??
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000'
    const passwordOk = await verifyPassword(storedHash, password)

    const locked = user?.lockedUntil && user.lockedUntil > now
    const usable = user && user.isActive && !user.deletedAt

    if (!user || !usable || locked || !passwordOk) {
      if (user && !locked) {
        const failed = user.failedLoginCount + 1
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed,
            lockedUntil:
              failed >= MAX_FAILED ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
          },
        })
      }
      await auditLogin(AUDIT_ACTION.LOGIN_FAILED, user?.id)
      throw new HttpError(401, GENERIC_FAILURE)
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    })

    const ctx = getRequestContext()
    const token = await createSession({
      userId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    await auditLogin(AUDIT_ACTION.LOGIN, user.id)

    res.cookie(SESSION_COOKIE, token, sessionCookieOptions())
    res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        residentId: user.residentId ?? null,
      },
    })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', async (req, res, next) => {
  try {
    await revokeSession(req.cookies?.[SESSION_COOKIE])
    // sessionMiddleware already resolved the session, so the id is free — no
    // second resolveSession, which would slide the idle expiry it just ended.
    if (req.session) disconnectSession(req.session.id)
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions())
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

/** Who am I. The admin app calls this on boot to restore session state. */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.session.userId,
      fullName: req.session.fullName,
      role: req.session.role,
      residentId: req.session.residentId,
    },
  })
})

export default router
