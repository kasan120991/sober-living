import { Router } from 'express'
import { prisma } from '../db/client.js'
import { handler } from '../lib/http.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import { STAFF_ROLE } from '../domain/constants.js'

const router = Router()

// Staff-only, and it returns staff — not residents. Names and roles of
// colleagues are not resident data and carry none of module 13's disclosure
// weight; a tech already sees "recorded by Priya Nair" on every record in the
// app. RESIDENT is excluded from the list itself, so a resident's linked
// account can never appear as a pickable witness.
router.use(requireAuth, requireStaff)

/**
 * The people who can witness a collection, take a roll, or acknowledge a
 * return — anywhere the app needs to name a colleague rather than assume it
 * was whoever is typing. Module 5's collection witness is the first consumer;
 * med pass will be the second.
 */
router.get(
  '/',
  handler(async (_req, res) => {
    const staff = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER, STAFF_ROLE.STAFF] },
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    })
    res.json({ staff })
  }),
)

export default router
