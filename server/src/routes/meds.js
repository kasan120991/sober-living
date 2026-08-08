import { Router } from 'express'
import { z } from 'zod'
import { handler, parseBody, parseQuery } from '../lib/http.js'
import { STAFF_ROLE } from '../domain/constants.js'
import { requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import {
  amendLog,
  deleteMedication,
  discontinueMedication,
  editMedication,
  houseMeds,
  passFor,
  recordDoses,
  recordPrnDose,
} from '../services/meds.js'

const router = Router()

// Staff throughout, never RESIDENT. The split inside that is deliberate and
// runs along one line: OBSERVING A DOSE IS A HALLWAY ACT, and DECIDING WHAT
// SOMEBODY TAKES IS NOT.
//
// So recording a dose and correcting a mis-tap are all-staff — the tech at the
// lockbox is the one holding the phone, and making them find a manager is how a
// pass ends up on paper, the same reasoning as sign-outs, the roll and the
// hourly round. Changing the med list is managers-only, the same line as
// setting a service-hours target or setting the schedule.
router.use(requireAuth, requireStaff)

const managers = requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER)

const STATUSES = ['GIVEN', 'REFUSED', 'HELD']
const WALL_CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const dateOnly = z.string().regex(DATE_ONLY, 'Expected YYYY-MM-DD')

const entry = z.object({
  medicationId: z.string().min(1),
  time: z.string().regex(WALL_CLOCK, 'Expected HH:MM'),
  status: z.enum(STATUSES),
  note: z.string().trim().max(280).optional(),
})

const recordBody = z.object({
  stayId: z.string().min(1),
  observedById: z.string().min(1),
  entries: z.array(entry).min(1).max(32),
})

const prnBody = z.object({
  medicationId: z.string().min(1),
  observedById: z.string().min(1),
  status: z.enum(STATUSES),
  note: z.string().trim().max(280).optional(),
})

const amendBody = z.object({
  amendmentReason: z.string().trim().min(1).max(500),
  status: z.enum(STATUSES).optional(),
  note: z.string().trim().max(280).optional(),
  observedById: z.string().min(1).optional(),
})

// `times` is deliberately NOT given a zod .default([]) — see the
// verify-schedule.js note about .partial() not stripping .default(). A default
// here would make a PATCH of only {name} parse to {name, times: []}, which
// editMedication would read as clearing the schedule.
const medicationShape = {
  name: z.string().trim().min(1).max(120),
  dosage: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(280).optional(),
  prescriber: z.string().trim().max(120).optional(),
  pharmacy: z.string().trim().max(120).optional(),
  times: z.array(z.string().regex(WALL_CLOCK, 'Expected HH:MM')).max(6),
  isPrn: z.boolean(),
  startsOn: dateOnly,
}

const createMedicationBody = z.object({
  ...medicationShape,
  times: medicationShape.times.default([]),
  isPrn: z.boolean().default(false),
})

const patchMedicationBody = z.object(medicationShape).partial()

const discontinueBody = z.object({
  endsOn: dateOnly,
  endReason: z.string().trim().min(1).max(280),
})

const listQuery = z.object({ date: dateOnly.optional() })

// ── The board ───────────────────────────────────────────────────────────────

router.get(
  '/',
  handler(async (req, res) => {
    const { date } = parseQuery(listQuery, req.query)
    res.json(await houseMeds({ date }))
  }),
)

// One resident's doses, WITH their medications named. The board carries counts
// only; this is the deliberate open.
router.get(
  '/pass/:stayId',
  handler(async (req, res) => {
    const { date } = parseQuery(listQuery, req.query)
    res.json(await passFor(req.params.stayId, { date }))
  }),
)

// ── Recording ───────────────────────────────────────────────────────────────

router.post(
  '/logs',
  handler(async (req, res) => {
    const data = parseBody(recordBody, req.body)
    res.status(201).json(await recordDoses(data, req.session.userId))
  }),
)

router.post(
  '/logs/prn',
  handler(async (req, res) => {
    const data = parseBody(prnBody, req.body)
    res.status(201).json(await recordPrnDose(data, req.session.userId))
  }),
)

router.post(
  '/logs/:id/amend',
  handler(async (req, res) => {
    const data = parseBody(amendBody, req.body)
    res.status(201).json(await amendLog(req.params.id, data, req.session.userId))
  }),
)

// ── The med list ────────────────────────────────────────────────────────────

router.patch(
  '/medications/:id',
  managers,
  handler(async (req, res) => {
    const data = parseBody(patchMedicationBody, req.body)
    res.json(await editMedication(req.params.id, data))
  }),
)

// Not a PATCH of `endsOn`: discontinuing carries its own rule (never before the
// last recorded dose) and its own required reason, so it gets its own route the
// way maintenance's close does rather than hiding inside a general edit.
router.post(
  '/medications/:id/discontinue',
  managers,
  handler(async (req, res) => {
    const data = parseBody(discontinueBody, req.body)
    res.json(await discontinueMedication(req.params.id, data))
  }),
)

router.delete(
  '/medications/:id',
  managers,
  handler(async (req, res) => {
    res.json(await deleteMedication(req.params.id))
  }),
)

export { createMedicationBody }
export default router
