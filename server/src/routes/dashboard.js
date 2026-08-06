import { Router } from 'express'

import { handler } from '../lib/http.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import { dashboard } from '../services/dashboard.js'

const router = Router()

// Staff only, never RESIDENT: the landing page names residents against
// sign-outs, beds owed and balances — the census rule applies with more force
// here, because this is the first screen every unlock shows.
router.use(requireAuth, requireStaff)

router.get('/', handler(async (_req, res) => res.json(await dashboard())))

export default router
