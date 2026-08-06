import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody } from '../lib/http.js'
import { requireAuth, requireStaff, requireRole } from '../middleware/authorize.js'
import { STAFF_ROLE } from '../domain/constants.js'
import { amendEntry, houseService, verifyEntry } from '../services/communityService.js'

const router = Router()

router.use(requireAuth, requireStaff)

// Logging and VERIFYING are both all-staff, and the second is the load-bearing
// one. The tech who is handed the signed slip at the door verifies it there and
// then — the same reasoning as sign-outs, where the tech records the departure
// AND acknowledges the return. Making them find a manager is how it ends up on
// paper that never gets entered.
//
// Once residents submit from the portal, the control that matters is that the
// verifier is not the resident, which all-staff satisfies by construction:
// residents are not staff. Setting the TARGET is a manager's job and lives on
// the residents router.
export const managers = requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER)

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')

/**
 * Hours in, minutes stored. Parsed HERE, once, so one rounding rule applies to
 * everyone — the same reason the ledger parses dollars to cents at the boundary
 * rather than trusting a client-side multiply.
 */
export const hoursToMinutes = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).trim())
    if (!Number.isFinite(n) || n < 0 || n > 24) {
      ctx.addIssue({ code: 'custom', message: 'hours' })
      return z.NEVER
    }
    // Quarter-hour granularity: a slip says "two and a half hours", never
    // "2.37". Rounding to the nearest minute would admit figures nobody wrote.
    return Math.round(n * 4) / 4 * 60
  })

export const amendBody = z.object({
  hours: hoursToMinutes.optional(),
  workedOn: dateStr.optional(),
  location: z.string().trim().min(1).max(140).optional(),
  supervisorName: z.string().trim().max(140).optional().nullable(),
  supervisorPhone: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  // The reason IS the record — the database refuses an amendment without one.
  amendmentReason: z.string().trim().min(1).max(500),
})

/** The house-wide page: the verification queue and everyone's progress. */
router.get('/', handler(async (_req, res) => res.json(await houseService())))

router.post(
  '/:id/verify',
  handler(async (req, res) => {
    res.json(await verifyEntry(req.params.id, req.session.userId))
  }),
)

router.post(
  '/:id/amend',
  handler(async (req, res) => {
    const data = parseBody(amendBody, req.body)
    const { hours, ...rest } = data
    res.status(201).json(
      await amendEntry(req.params.id, { ...rest, minutes: hours }, req.session.userId),
    )
  }),
)

export default router
