import { Router } from 'express'
import { z } from 'zod'
import { handler, parseBody } from '../lib/http.js'
import { STAFF_ROLE } from '../domain/constants.js'
import { requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import {
  cancelPass,
  housePasses,
  returnPass,
  reviewPass,
  withdrawPass,
} from '../services/passes.js'

const router = Router()

// Staff throughout, never RESIDENT. The split inside runs along one line:
// FILING A REQUEST IS A HALLWAY ACT, DECIDING IT IS A JUDGEMENT.
//
// A tech is the person a resident actually asks, and making them find a manager
// to type the request is how a request never gets filed at all — the sign-out,
// roll and hourly-round reasoning. Approving, denying and cancelling sit with
// managers, where every other judgement in this app sits.
//
// Acknowledging a return is all-staff for the same reason a sign-out's return
// is: the person at the door is the one who sees them walk in.
router.use(requireAuth, requireStaff)

const managers = requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER)

const reviewBody = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
})

const cancelBody = z.object({ note: z.string().trim().min(1).max(500) })

router.get('/', handler(async (_req, res) => res.json(await housePasses())))

router.post(
  '/:id/review',
  managers,
  handler(async (req, res) => {
    const data = parseBody(reviewBody, req.body)
    res.json(await reviewPass(req.params.id, data, req.session.userId))
  }),
)

router.post(
  '/:id/return',
  handler(async (req, res) => res.json(await returnPass(req.params.id, req.session.userId))),
)

router.post(
  '/:id/cancel',
  managers,
  handler(async (req, res) => {
    const data = parseBody(cancelBody, req.body)
    res.json(await cancelPass(req.params.id, data, req.session.userId))
  }),
)

// Withdrawing an undecided request is soft and all-staff — whoever filed it in
// error can take it back, but only while nobody has decided it.
router.delete(
  '/:id',
  handler(async (req, res) => res.json(await withdrawPass(req.params.id))),
)

export default router
