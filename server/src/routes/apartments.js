import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody } from '../lib/http.js'
import { requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import { STAFF_ROLE } from '../domain/constants.js'
import {
  createApartment,
  deleteApartment,
  getApartment,
  listApartments,
  updateApartment,
} from '../services/apartments.js'
import { createBeds } from '../services/beds.js'

const router = Router()

// Admins own the physical layout; managers and techs read it.
const adminOnly = requireRole(STAFF_ROLE.ADMIN)

// No timezone or address: the facility is one site at one address. See
// FACILITY_TIMEZONE.
const apartmentBody = z.object({
  name: z.string().trim().min(1).max(80),
  cohort: z.enum(['MEN', 'WOMEN']),
})

const bedsBody = z
  .object({
    // Single: an explicit label. Bulk: a count and a scheme.
    label: z.string().trim().min(1).max(8).optional(),
    count: z.number().int().min(1).max(24).optional(),
    scheme: z.enum(['alpha', 'numeric']).optional(),
  })
  .refine((v) => Boolean(v.label) !== Boolean(v.count), {
    message: 'Provide either a label or a count, not both',
  })

router.use(requireAuth, requireStaff)

router.get('/', handler(async (_req, res) => res.json({ apartments: await listApartments() })))

router.get('/:id', handler(async (req, res) => res.json(await getApartment(req.params.id))))

router.post(
  '/',
  adminOnly,
  handler(async (req, res) => {
    const data = parseBody(apartmentBody, req.body)
    res.status(201).json(await createApartment(data))
  }),
)

router.patch(
  '/:id',
  adminOnly,
  handler(async (req, res) => {
    const data = parseBody(apartmentBody.partial(), req.body)
    res.json(await updateApartment(req.params.id, data))
  }),
)

router.delete(
  '/:id',
  adminOnly,
  handler(async (req, res) => {
    await deleteApartment(req.params.id)
    res.status(204).end()
  }),
)

router.post(
  '/:id/beds',
  adminOnly,
  handler(async (req, res) => {
    const body = parseBody(bedsBody, req.body)
    const beds = await createBeds(req.params.id, {
      labels: body.label ? [body.label] : null,
      scheme: body.scheme ?? 'alpha',
      count: body.count,
    })
    res.status(201).json({ beds })
  }),
)

export default router
