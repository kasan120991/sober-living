import { Router } from 'express'
import { handler } from '../lib/http.js'
import { requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import { STAFF_ROLE } from '../domain/constants.js'
import { billingBoard } from '../services/billing.js'

/**
 * The billing screen's one read.
 *
 * MANAGERS AND ADMINS, and this gate is the one that actually holds — the
 * sidebar hiding the link is presentation, never protection, so a tech typing
 * /billing gets data refused rather than a page that quietly renders.
 *
 * The resident record's ledger read stays ALL-STAFF and is not touched: a tech
 * asked "what do I owe" at the door reads one resident's balance there. This is
 * the facility's money in aggregate, which is a manager's question.
 */
const router = Router()
router.use(requireAuth, requireStaff, requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER))

router.get('/', handler(async (_req, res) => res.json(await billingBoard())))

export default router
