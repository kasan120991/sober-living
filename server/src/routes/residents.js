import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody } from '../lib/http.js'
import { requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import { STAFF_ROLE } from '../domain/constants.js'
import {
  addContact,
  availableBeds,
  dischargeResident,
  getResident,
  intakeResident,
  cohortCapacity,
  listResidents,
  releaseBed,
  unhousedWithOptions,
  removeContact,
  transferBed,
  updateContact,
  updateResident,
} from '../services/residents.js'

const router = Router()

// Intake, discharge and moving people between beds are record events with
// weight. Techs read the roster; managers and admins change it.
const managers = requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER)

const iso = z.string().trim().min(1)

const intakeBody = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  cohort: z.enum(['MEN', 'WOMEN']),
  dateOfBirth: iso.optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().email().max(320).optional().nullable().or(z.literal('')),
  intakeAt: iso.optional().nullable(),
  expectedDischargeAt: iso.optional().nullable(),
  programId: z.string().optional().nullable(),
  referralSource: z.string().trim().max(160).optional().nullable(),
  bedId: z.string().optional().nullable(),
  emergencyContact: z
    .object({
      name: z.string().trim().max(120).optional(),
      relationship: z.string().trim().max(60).optional().nullable(),
      phone: z.string().trim().max(32).optional(),
    })
    .optional(),
})

const residentPatch = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  dateOfBirth: iso.optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().email().max(320).optional().nullable().or(z.literal('')),
})

const dischargeBody = z.object({
  dischargeType: z.enum(['SUCCESSFUL', 'AMA', 'ADMINISTRATIVE', 'TRANSFER']),
  dischargeReason: z.string().trim().min(1).max(2000),
})

const contactBody = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(60).optional().nullable(),
  phone: z.string().trim().min(1).max(32),
  isPrimary: z.boolean().optional(),
})

router.use(requireAuth, requireStaff)

router.get(
  '/',
  handler(async (req, res) => {
    const includeDischarged = req.query.includeDischarged === 'true'
    // Capacity and the unhoused list ship with the roster rather than as extra
    // round trips — the header renders from the same request as the table.
    const [residents, capacity, unhoused] = await Promise.all([
      listResidents({ includeDischarged }),
      cohortCapacity(),
      unhousedWithOptions(),
    ])
    res.json({ residents, capacity, unhoused })
  }),
)

/** Beds a resident could move into. Query param, so it must precede /:id. */
router.get(
  '/available-beds',
  handler(async (req, res) => {
    const cohort = req.query.cohort
    if (cohort !== 'MEN' && cohort !== 'WOMEN') throw new Error('cohort is required')
    res.json({ beds: await availableBeds(cohort) })
  }),
)

router.get('/:id', handler(async (req, res) => res.json(await getResident(req.params.id))))

router.post(
  '/',
  managers,
  handler(async (req, res) => {
    const data = parseBody(intakeBody, req.body)
    res.status(201).json(await intakeResident(data, req.session.userId))
  }),
)

router.patch(
  '/:id',
  managers,
  handler(async (req, res) => {
    const data = parseBody(residentPatch, req.body)
    res.json(await updateResident(req.params.id, data))
  }),
)

router.post(
  '/:id/discharge',
  managers,
  handler(async (req, res) => {
    const data = parseBody(dischargeBody, req.body)
    res.json(await dischargeResident(req.params.id, data))
  }),
)

router.post(
  '/:id/bed',
  managers,
  handler(async (req, res) => {
    const { bedId } = parseBody(z.object({ bedId: z.string().min(1) }), req.body)
    res.json(await transferBed(req.params.id, bedId, req.session.userId))
  }),
)

router.delete(
  '/:id/bed',
  managers,
  handler(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null
    res.json(await releaseBed(req.params.id, reason))
  }),
)

router.post(
  '/:id/contacts',
  managers,
  handler(async (req, res) => {
    const data = parseBody(contactBody, req.body)
    res.status(201).json(await addContact(req.params.id, data))
  }),
)

router.patch(
  '/contacts/:contactId',
  managers,
  handler(async (req, res) => {
    const data = parseBody(contactBody.partial(), req.body)
    res.json(await updateContact(req.params.contactId, data))
  }),
)

router.delete(
  '/contacts/:contactId',
  managers,
  handler(async (req, res) => {
    await removeContact(req.params.contactId)
    res.status(204).end()
  }),
)

export default router
