import { Router } from 'express'

import { handler } from '../lib/http.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import { census } from '../services/census.js'

const router = Router()

// Staff only, never RESIDENT: the census is every housed resident by name.
router.use(requireAuth, requireStaff)

router.get('/', handler(async (_req, res) => res.json(await census())))

export default router
