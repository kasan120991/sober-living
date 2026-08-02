import { Router } from 'express'

import { handler } from '../lib/http.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import { search } from '../services/search.js'
import { facilityStatus } from '../services/facilityStatus.js'

const router = Router()

// requireStaff, not requireAuth alone. A resident account must never be able to
// ask whether a named person is in this facility — that question and its answer
// are the disclosure 42 CFR Part 2 exists to prevent.
router.use(requireAuth, requireStaff)

router.get(
  '/',
  handler(async (req, res) => {
    // `q` reaches the service and nothing else. It is not logged, not audited,
    // and not echoed back in an error — it is somebody's name.
    res.json(await search(req.query.q))
  }),
)

router.get('/status', handler(async (_req, res) => res.json(await facilityStatus())))

export default router
