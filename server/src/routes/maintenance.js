import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody, parseQuery } from '../lib/http.js'
import { requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS, STAFF_ROLE } from '../domain/constants.js'
import {
  closeRequest,
  createRequest,
  editRequest,
  houseMaintenance,
  listRequests,
  reopenRequest,
  setPriority,
  startWork,
} from '../services/maintenance.js'

const router = Router()

const PRIORITIES = Object.values(MAINTENANCE_PRIORITY)
const STATUSES = Object.values(MAINTENANCE_STATUS)

/**
 * The query is parsed like every body is.
 *
 * It was not until 2026-08-07: `req.query.status` went straight into a Prisma
 * `where`, so `?status=FOO` surfaced as a raw enum error and a 500 where every
 * other bad input in this app is a 400. `open` is the one value that is not a
 * status — it means both live states.
 */
const listQuery = z.object({
  status: z.enum(['open', ...STATUSES]).optional(),
  apartmentId: z.string().min(1).optional(),
  priority: z.enum(PRIORITIES).optional(),
})

const createBody = z.object({
  apartmentId: z.string().min(1),
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(PRIORITIES).optional(),
})

const startBody = z.object({
  assignedToId: z.string().min(1).optional().nullable(),
  vendorName: z.string().trim().max(140).optional().nullable(),
  workOrderRef: z.string().trim().max(80).optional().nullable(),
})

const closeBody = z.object({
  status: z.enum([MAINTENANCE_STATUS.RESOLVED, MAINTENANCE_STATUS.CANCELLED]),
  note: z.string().trim().min(1).max(2000),
})

const reopenBody = z.object({
  note: z.string().trim().min(1).max(2000),
})

const priorityBody = z.object({
  priority: z.enum(PRIORITIES),
})

/// Identity and placement. Deliberately NOT status or priority — those have
/// their own routes because they have their own rules.
const editBody = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  apartmentId: z.string().min(1).optional(),
})

router.use(requireAuth, requireStaff)

// Any staff may see and file. A tech who finds a broken latch during an
// apartment check should be able to record it there and then.
router.get(
  '/',
  handler(async (req, res) => {
    const query = parseQuery(listQuery, req.query)
    res.json({ requests: await listRequests(query) })
  }),
)

/// The page's one composed read — rows, figures and the targets in one call.
router.get(
  '/house',
  handler(async (_req, res) => {
    res.json(await houseMaintenance())
  }),
)

router.post(
  '/',
  handler(async (req, res) => {
    const data = parseBody(createBody, req.body)
    res.status(201).json(await createRequest(data, req.session.userId))
  }),
)

// Taking a job is a hallway act, so all-staff — the same reasoning as recording
// a sign-out or taking a roll. Naming nobody assigns it to whoever tapped it.
router.post(
  '/:id/start',
  handler(async (req, res) => {
    const data = parseBody(startBody, req.body ?? {})
    res.json(await startWork(req.params.id, data, req.session.userId))
  }),
)

// Closing is an admin/manager action — it is the record that says work is done.
router.post(
  '/:id/close',
  requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER),
  handler(async (req, res) => {
    const data = parseBody(closeBody, req.body)
    res.json(await closeRequest(req.params.id, data, req.session.userId))
  }),
)

// Reopening undoes a manager's record, so it sits with managers too.
router.post(
  '/:id/reopen',
  requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER),
  handler(async (req, res) => {
    const data = parseBody(reopenBody, req.body)
    res.json(await reopenRequest(req.params.id, data, req.session.userId))
  }),
)

// All-staff, and the service refuses it once the request is closed. Correcting
// what you filed is the same kind of act as filing it.
router.patch(
  '/:id',
  handler(async (req, res) => {
    const data = parseBody(editBody, req.body)
    res.json(await editRequest(req.params.id, data))
  }),
)

// Deliberately NOT gated by middleware: raising is all-staff and lowering is
// managers, and which one this is depends on the body. The rule lives in
// setPriority() with its reasoning rather than being split across the two.
router.patch(
  '/:id/priority',
  handler(async (req, res) => {
    const { priority } = parseBody(priorityBody, req.body)
    res.json(await setPriority(req.params.id, priority, { actorRole: req.session.role }))
  }),
)

export default router
