import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody } from '../lib/http.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import {
  acknowledgeReturn,
  listSignOuts,
  recordSignOut,
  removeSignOut,
} from '../services/signOuts.js'

const router = Router()

// All staff, for every action here: a tech at the door records the sign-out
// and sees the return. Making a tech find a manager for either is how it ends
// up on paper instead.
router.use(requireAuth, requireStaff)

// Wall-clock strings, interpreted server-side in the facility timezone.
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM')
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')

const createBody = z.object({
  residentId: z.string().min(1),
  destination: z.string().trim().min(1).max(140),
  purpose: z.string().trim().max(500).optional().nullable(),
  // Out defaults to "now"; expected return requires at least a time, with the
  // facility's today as the default date.
  outDate: dateStr.optional(),
  outTime: timeStr.optional(),
  expectedReturnDate: dateStr.optional(),
  expectedReturnTime: timeStr,
})

const returnBody = z.object({
  returnedDate: dateStr.optional(),
  returnedTime: timeStr.optional(),
})

router.get('/', handler(async (_req, res) => res.json(await listSignOuts())))

router.post(
  '/',
  handler(async (req, res) => {
    const data = parseBody(createBody, req.body)
    res.status(201).json(await recordSignOut(data, req.session.userId))
  }),
)

router.post(
  '/:id/return',
  handler(async (req, res) => {
    const data = parseBody(returnBody, req.body ?? {})
    res.json(await acknowledgeReturn(req.params.id, data, req.session.userId))
  }),
)

router.delete(
  '/:id',
  handler(async (req, res) => {
    await removeSignOut(req.params.id)
    res.status(204).end()
  }),
)

export default router
