import { Router } from 'express'
import { z } from 'zod'
import { handler, parseBody } from '../lib/http.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import {
  amendScreen,
  getScreen,
  houseScreens,
  recordDecision,
  recordLabResult,
  recordScreen,
} from '../services/screens.js'

const router = Router()

// All-staff throughout, and NEVER RESIDENT — requireStaff is the boundary.
//
// The gate worth arguing about is the decision route below, because it posts
// money. The argument: the resident answers in front of the tech holding the
// cup, and making that tech find a manager first is how "he declined" ends up
// unrecorded — which is the exact evidence gap this module exists to close.
// The $50 is a fixed consequence of a recorded fact, not a discretionary post;
// module 11's manager-only rule governs the ledger ROUTE, where a human picks
// an amount, a category and a description. Here they pick none of them.
router.use(requireAuth, requireStaff)

const RESULTS = ['NEGATIVE', 'POSITIVE', 'REFUSAL', 'DILUTE', 'PENDING']
const SUBSTANCES = [
  'ALCOHOL', 'AMPHETAMINES', 'BARBITURATES', 'BENZODIAZEPINES', 'BUPRENORPHINE',
  'COCAINE', 'FENTANYL', 'MDMA', 'METHADONE', 'METHAMPHETAMINE', 'OPIATES',
  'OXYCODONE', 'PCP', 'THC', 'OTHER',
]

const createBody = z.object({
  residentId: z.string().min(1),
  reason: z.enum(['RANDOM', 'FOR_CAUSE']),
  method: z.enum(['URINE', 'ORAL_FLUID', 'BREATH']),
  result: z.enum(RESULTS),
  substances: z.array(z.enum(SUBSTANCES)).max(15).optional(),
  specimenId: z.string().trim().max(60).optional(),
  witnessedById: z.string().min(1),
  collectedAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
})

const decisionBody = z.object({
  decision: z.enum(['DECLINED', 'REQUESTED']),
  labName: z.string().trim().max(120).optional(),
  labReference: z.string().trim().max(80).optional(),
})

const labBody = z.object({
  labResult: z.enum(RESULTS),
  labSubstances: z.array(z.enum(SUBSTANCES)).max(15).optional(),
  labReference: z.string().trim().max(80).optional(),
})

const amendBody = z.object({
  amendmentReason: z.string().trim().min(1).max(500),
  reason: z.enum(['RANDOM', 'FOR_CAUSE']).optional(),
  method: z.enum(['URINE', 'ORAL_FLUID', 'BREATH']).optional(),
  result: z.enum(RESULTS).optional(),
  substances: z.array(z.enum(SUBSTANCES)).max(15).optional(),
  specimenId: z.string().trim().max(60).optional(),
  witnessedById: z.string().min(1).optional(),
  note: z.string().trim().max(500).optional(),
})

/** The work queue. Carries NO outcomes — see GET /:id. */
router.get('/', handler(async (_req, res) => res.json(await houseScreens())))

// One screen, WITH its outcome. This is the reveal, and it is a real
// authorization and audit boundary rather than a client-side curtain: the
// audit log names exactly the screens somebody actually looked at.
router.get('/:id', handler(async (req, res) => res.json(await getScreen(req.params.id))))

router.post('/', handler(async (req, res) => {
  const data = parseBody(createBody, req.body)
  res.status(201).json(await recordScreen(data, req.session.userId))
}))

router.post('/:id/decision', handler(async (req, res) => {
  const data = parseBody(decisionBody, req.body)
  res.json(await recordDecision(req.params.id, data, req.session.userId))
}))

router.post('/:id/lab', handler(async (req, res) => {
  const data = parseBody(labBody, req.body)
  res.json(await recordLabResult(req.params.id, data, req.session.userId))
}))

router.post('/:id/amend', handler(async (req, res) => {
  const data = parseBody(amendBody, req.body)
  res.status(201).json(await amendScreen(req.params.id, data, req.session.userId))
}))

export default router
