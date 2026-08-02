import { Router } from 'express'

import { handler } from '../lib/http.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import { listNotifications } from '../services/notifications.js'

const router = Router()

// Every staff role, because every item here is something any of them might be
// standing in front of. Residents are not staff and never reach this.
router.use(requireAuth, requireStaff)

router.get('/', handler(async (_req, res) => res.json(await listNotifications())))

export default router
