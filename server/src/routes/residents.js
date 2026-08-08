import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody } from '../lib/http.js'
import { HttpError, requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import { LEDGER_CATEGORY, LEDGER_ENTRY_TYPE, STAFF_ROLE } from '../domain/constants.js'
import {
  addContact,
  availableBeds,
  dischargeResident,
  getResident,
  intakeResident,
  cohortCapacity,
  listPrograms,
  listResidents,
  releaseBed,
  unhousedWithOptions,
  removeContact,
  transferBed,
  updateContact,
  updateResident,
} from '../services/residents.js'
import {
  activeStayIdFor,
  listEntries,
  postEntry,
  removePendingCharge,
} from '../services/ledger.js'
import { residentChecks } from '../services/checks.js'
import { residentScreens } from '../services/screens.js'
import { addMedication, residentMeds } from '../services/meds.js'
import { createMedicationBody } from './meds.js'
import { residentInvoiceRoutes } from './invoices.js'
import { residentSchedule } from '../services/schedule/read.js'
// Aliased: the ledger exports a listEntries too, and this file imports both.
import {
  listEntries as listServiceEntries,
  logEntry,
  setStayTarget,
} from '../services/communityService.js'
import { hoursToMinutes } from './service.js'

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')

const serviceBody = z.object({
  hours: hoursToMinutes,
  workedOn: dateOnly,
  location: z.string().trim().min(1).max(140),
  supervisorName: z.string().trim().max(140).optional().nullable(),
  supervisorPhone: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
})

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

  // Exactly four digits or nothing. The database refuses anything else too —
  // the case worth catching is a whole SSN pasted into a box labelled "last 4",
  // and it should fail here with a message a person can act on.
  ssnLast4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Enter only the last four digits')
    .optional()
    .nullable()
    .or(z.literal('')),

  sobrietyDate: iso.optional().nullable(),
  intakeNotes: z.string().trim().max(4000).optional().nullable(),

  insurance: z
    .object({
      provider: z.string().trim().max(120).optional(),
      policyNumber: z.string().trim().max(60).optional(),
      groupNumber: z.string().trim().max(60).optional().nullable(),
      // Blank means the resident is the policy holder. Storing the words
      // "same as client" would make that unqueryable.
      policyHolder: z.string().trim().max(120).optional().nullable(),
    })
    .optional(),

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

// Money is entered in dollars by a human and stored in cents. Parsing here
// rather than trusting a client-side multiply: 12.10 * 100 is 1209.9999... in
// float, and a cent lost on every charge is a ledger nobody can reconcile.
const dollarsToCents = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const s = String(v).trim().replace(/[$,]/g, '')
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount like 650 or 650.50' })
      return z.NEVER
    }
    const [whole, frac = ''] = s.split('.')
    const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
    if (cents <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be more than zero' })
      return z.NEVER
    }
    return cents
  })

// Required, and required for the same reason every amendment in this app needs
// one: the pair is permanent evidence, and "why" is the only part of it a
// reader cannot reconstruct from the rows themselves.
const removeBody = z.object({ reason: z.string().trim().min(1).max(300) })

const ledgerBody = z.object({
  type: z.enum(Object.values(LEDGER_ENTRY_TYPE)),
  // DERIVED from the frozen constant, not written out again. The hand-written
  // list here silently omitted LAB_FEE when module 5 added it, so the dialog
  // offered "Lab fee" and the server answered "Invalid category" — nobody could
  // hand-post or correct one. Deriving it is what the frozen-constant
  // convention is FOR: the next value cannot drift.
  category: z.enum(Object.values(LEDGER_CATEGORY)).optional().nullable(),
  amount: dollarsToCents,
  description: z.string().trim().min(1).max(300),
  occurredAt: iso.optional().nullable(),
  correctsId: z.string().min(1).optional().nullable(),
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

/** Static-ish list for the intake form. Must precede /:id. */
router.get('/programs', handler(async (_req, res) => res.json({ programs: await listPrograms() })))

/** Beds a resident could move into. Query param, so it must precede /:id. */
router.get(
  '/available-beds',
  handler(async (req, res) => {
    const cohort = req.query.cohort
    if (cohort !== 'MEN' && cohort !== 'WOMEN') throw new HttpError(400, 'cohort is required')
    res.json({ beds: await availableBeds(cohort) })
  }),
)

router.get(
  '/:id',
  handler(async (req, res) =>
    res.json(await getResident(req.params.id, { viewerRole: req.session.role })),
  ),
)

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

// ── Community service ─────────────────────────────────────────────────────
// Reading and LOGGING are all-staff; setting the target is not. See
// routes/service.js for the verification half and the reasoning.
router.get(
  '/:id/service',
  handler(async (req, res) => {
    const stayId = await activeStayIdFor(req.params.id)
    if (!stayId) return res.json({ entries: [], stayId: null })
    res.json({ entries: await listServiceEntries(stayId), stayId })
  }),
)

router.post(
  '/:id/service',
  handler(async (req, res) => {
    const data = parseBody(serviceBody, req.body)
    const stayId = await activeStayIdFor(req.params.id)
    if (!stayId) throw new HttpError(409, 'This resident has no active stay.')
    const { hours, ...rest } = data
    res.status(201).json(await logEntry({ ...rest, stayId, minutes: hours }, req.session.userId))
  }),
)

router.patch(
  '/:id/service-target',
  managers,
  handler(async (req, res) => {
    const { hours } = parseBody(
      z.object({ hours: z.number().int().min(0).max(2000).nullable() }),
      req.body,
    )
    const stayId = await activeStayIdFor(req.params.id)
    if (!stayId) throw new HttpError(409, 'This resident has no active stay.')
    await setStayTarget(stayId, hours)
    res.status(204).end()
  }),
)

// ── Schedule ──────────────────────────────────────────────────────────────
// Read-only here: the record answers what this person is scheduled for, and the
// event itself is edited from the schedule module. A join through THEIR
// ATTENDEE ROWS, never a query on their cohort — so a resident on nothing gets
// an empty list rather than everything their cohort does.
router.get(
  '/:id/schedule',
  handler(async (req, res) => res.json(await residentSchedule(req.params.id))),
)

// ── Apartment checks ──────────────────────────────────────────────────────
// Read-only: the record answers where this person was last seen and how the
// rounds have found them; recording and amending live on /checks. The read is
// their LINES via their stay — never the apartment's whole history.
router.get(
  '/:id/checks',
  handler(async (req, res) => {
    const { date, cursor, limit } = req.query
    if (date !== undefined && !dateOnly.safeParse(date).success) {
      throw new HttpError(400, 'date must be YYYY-MM-DD')
    }
    res.json(
      await residentChecks(req.params.id, {
        date,
        cursor,
        // Clamped; exposed chiefly so the verify suite can pin pagination.
        limit: limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100) : undefined,
      }),
    )
  }),
)

// ── Drug screens ──────────────────────────────────────────────────────────
// READ-ONLY here, the Apartment checks precedent: the record answers what this
// person's screens have found; recording, the decision, the lab result and
// amendments all live on /screens. Deliberately unlike the Community service
// section, which does post from the record — a screen needs a specimen, a
// witness and a cup read in a hallway, and a form on a record page is an
// invitation to reconstruct one from memory.
//
// Outcomes are omitted here as they are on the queue; revealing one fetches
// GET /screens/:id, so the audit log names what was actually looked at.
router.get(
  '/:id/screens',
  handler(async (req, res) => res.json(await residentScreens(req.params.id))),
)

// ── Medications ───────────────────────────────────────────────────────────
// Read-only here, the Apartment checks and Drug screens precedent: the record
// answers what this person is on and how their doses have gone; recording,
// amending and changing the list all live on /meds.
//
// Medications ARE named in this payload, unlike anywhere on the med pass
// board. Same exception, same justification as screens on the record: a record
// page is a deliberate navigation to one person somebody already chose, and the
// audit log records it at that grain.
router.get(
  '/:id/meds',
  handler(async (req, res) => {
    const { date, cursor, limit } = req.query
    if (date !== undefined && !dateOnly.safeParse(date).success) {
      throw new HttpError(400, 'date must be YYYY-MM-DD')
    }
    res.json(
      await residentMeds(req.params.id, {
        date,
        cursor,
        limit: limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100) : undefined,
      }),
    )
  }),
)

// Adding a medication is MANAGERS, and it lives here rather than on /meds
// because it is addressed by resident: the service resolves their active stay,
// which is what a medication actually hangs off.
router.post(
  '/:id/medications',
  requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER),
  handler(async (req, res) => {
    const data = parseBody(createMedicationBody, req.body)
    res.status(201).json(await addMedication(req.params.id, data, req.session.userId))
  }),
)

// ── Invoices ──────────────────────────────────────────────────────────────
// Read is all-staff like the ledger's; sending is managers. Mounted from
// routes/invoices.js so the invoice rules live in one file.
residentInvoiceRoutes(router)

// ── Fee ledger ────────────────────────────────────────────────────────────
// Read is open to any staff member: a tech asked "what do I owe" at the door
// should be able to answer without finding a manager. Posting to it is not.
router.get(
  '/:id/ledger',
  handler(async (req, res) => {
    const stayId = await activeStayIdFor(req.params.id)
    if (!stayId) {
      return res.json({
        entries: [],
        balanceCents: 0,
        pendingCents: 0,
        draftCents: 0,
        draftCount: 0,
        stayId: null,
      })
    }
    res.json({ ...(await listEntries(stayId)), stayId })
  }),
)

router.post(
  '/:id/ledger',
  managers,
  handler(async (req, res) => {
    const data = parseBody(ledgerBody, req.body)
    const stayId = await activeStayIdFor(req.params.id)
    // HttpError, not Error: errorHandler replaces the message on anything >= 500,
    // so a bare Error would reach the user as "Internal server error". This is a
    // likely race from a row menu — the roster is a snapshot, and the resident
    // may have been discharged in another tab since it was drawn.
    if (!stayId) throw new HttpError(409, 'This resident has no active stay to bill.')
    const entry = await postEntry(
      {
        stayId,
        type: data.type,
        category: data.category ?? null,
        amountCents: data.amount,
        description: data.description,
        occurredAt: data.occurredAt,
        correctsId: data.correctsId ?? null,
      },
      req.session.userId,
    )
    res.status(201).json(entry)
  }),
)

// Removing a PENDING charge. Its own route rather than a hand-built CREDIT
// through the one above, because every term of the reversal — the amount, the
// type, the date, whose ledger it lands on — is determined by the charge being
// reversed. Only the reason comes from a human, which is exactly the line
// module 5 drew for when a service may post to the ledger itself.
//
// Managers, like every other write here: a tech reads a balance, never changes
// one. Nothing is deleted — see `removePendingCharge`.
router.post(
  '/:id/ledger/:entryId/remove',
  managers,
  handler(async (req, res) => {
    const { reason } = parseBody(removeBody, req.body)
    const stayId = await activeStayIdFor(req.params.id)
    if (!stayId) throw new HttpError(409, 'This resident has no active stay.')
    res
      .status(201)
      .json(await removePendingCharge(stayId, req.params.entryId, reason, req.session.userId))
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
