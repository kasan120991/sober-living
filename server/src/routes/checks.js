import { Router } from 'express'
import { z } from 'zod'
import { handler, parseBody } from '../lib/http.js'
import { CHECK_RESIDENT_STATUS } from '../domain/constants.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import { amendCheck, getCheck, houseChecks, recordCheck, rosterFor } from '../services/checks.js'

const router = Router()

// All-staff throughout, including amendments: the tech in the hallway is the
// one holding the phone, and making them find a manager to record — or to fix
// a mis-tap — is how rounds end up on paper. Same reasoning as sign-outs and
// the roll. Never RESIDENT: requireStaff is the boundary.
router.use(requireAuth, requireStaff)

// Derived from the domain constant rather than re-typed, so a status added to
// the enum cannot be one the route silently refuses. That is not hypothetical:
// ON_PASS shipped in the schema, the service and the check sheet while this
// list still named three, so the one path that could set it answered 400 —
// module 10's vendorName gap in a different costume.
const line = z.object({
  stayId: z.string().min(1),
  status: z.enum(Object.values(CHECK_RESIDENT_STATUS)),
  note: z.string().trim().max(280).optional(),
})

const createBody = z.object({
  apartmentId: z.string().min(1),
  note: z.string().trim().max(500).optional(),
  lines: z.array(line).max(64),
})

const amendBody = z.object({
  amendmentReason: z.string().trim().min(1).max(500),
  note: z.string().trim().max(500).optional(),
  lines: z.array(line).max(64).optional(),
})

router.get('/', handler(async (_req, res) => res.json(await houseChecks())))

router.get('/roster/:apartmentId', handler(async (req, res) => {
  res.json(await rosterFor(req.params.apartmentId))
}))

router.get('/:id', handler(async (req, res) => res.json(await getCheck(req.params.id))))

router.post('/', handler(async (req, res) => {
  const data = parseBody(createBody, req.body)
  res.status(201).json(await recordCheck(data, req.session.userId))
}))

router.post('/:id/amend', handler(async (req, res) => {
  const data = parseBody(amendBody, req.body)
  res.status(201).json(await amendCheck(req.params.id, data, req.session.userId))
}))

export default router
