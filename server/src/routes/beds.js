import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody } from '../lib/http.js'
import { requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import { STAFF_ROLE } from '../domain/constants.js'
import { deleteBed, updateBed } from '../services/beds.js'

const router = Router()

const bedPatch = z.object({
  label: z.string().trim().min(1).max(8).optional(),
  status: z.enum(['ACTIVE', 'OUT_OF_SERVICE']).optional(),
  outOfServiceNote: z.string().trim().max(280).optional().nullable(),
})

router.use(requireAuth, requireStaff)

/**
 * Field-level authorization lives in the service, not here: an admin may change
 * anything, a manager only whether the bed is usable. requireRole cannot express
 * "these fields but not those".
 */
router.patch(
  '/:id',
  handler(async (req, res) => {
    const data = parseBody(bedPatch, req.body)
    res.json(await updateBed(req.params.id, data, req.session.role))
  }),
)

router.delete(
  '/:id',
  requireRole(STAFF_ROLE.ADMIN),
  handler(async (req, res) => {
    await deleteBed(req.params.id)
    res.status(204).end()
  }),
)

export default router
