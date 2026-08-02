import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody } from '../lib/http.js'
import { requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import { STAFF_ROLE } from '../domain/constants.js'
import { createRequest, listRequests, updateRequest } from '../services/maintenance.js'

const router = Router()

const createBody = z.object({
  apartmentId: z.string().min(1),
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(['LOW', 'NORMAL', 'URGENT']).optional(),
})

const patchBody = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'URGENT']).optional(),
  resolutionNote: z.string().trim().max(2000).optional().nullable(),
})

router.use(requireAuth, requireStaff)

// Any staff may see and file. A tech who finds a broken latch during an
// apartment check should be able to record it there and then.
router.get(
  '/',
  handler(async (req, res) => {
    const { status, apartmentId } = req.query
    res.json({ requests: await listRequests({ status, apartmentId }) })
  }),
)

router.post(
  '/',
  handler(async (req, res) => {
    const data = parseBody(createBody, req.body)
    res.status(201).json(await createRequest(data, req.session.userId))
  }),
)

// Closing is an admin/manager action — it is the record that says work is done.
router.patch(
  '/:id',
  requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER),
  handler(async (req, res) => {
    const data = parseBody(patchBody, req.body)
    res.json(await updateRequest(req.params.id, data, req.session.userId))
  }),
)

export default router
