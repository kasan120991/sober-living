import { Router } from 'express'
import { z } from 'zod'
import { handler, parseBody } from '../lib/http.js'
import { HttpError, requireAuth, requireRole, requireStaff } from '../middleware/authorize.js'
import { STAFF_ROLE } from '../domain/constants.js'
import { activeStayIdFor } from '../services/ledger.js'
import {
  billableStays,
  listInvoices,
  resumeSend,
  sendInvoice,
  voidInvoice,
} from '../services/invoices.js'

const router = Router()
router.use(requireAuth, requireStaff)

// Reading stays all-staff, module 11's rule: a tech asked "when is my invoice
// due" at the door should not have to find a manager. Sending is managers, and
// VOIDING is admins only — the narrowest gate in the app, because a void
// strands its lines permanently.
const managers = requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER)
const admins = requireRole(STAFF_ROLE.ADMIN)

const sendBody = z.object({
  // Due on receipt is the facility's rule, so this is optional and defaults to
  // now. It stays overridable because a manager occasionally agrees terms.
  dueAt: z.string().datetime().optional(),
})
const voidBody = z.object({ reason: z.string().trim().min(1).max(300) })

/** Who has something worth billing — what the Friday button acts on. */
router.get('/billable', handler(async (_req, res) => res.json({ stays: await billableStays() })))

router.post(
  '/weekly-run',
  managers,
  handler(async (req, res) => {
    // Each stay independently: one resident's Stripe failure leaves a
    // recoverable draft and must not abort everybody else's invoice.
    const stays = await billableStays()
    const results = []
    for (const s of stays) {
      try {
        const invoice = await sendInvoice(s.stayId, { dueAt: new Date() }, req.session.userId)
        results.push({ ...s, ok: true, invoiceId: invoice.id, status: invoice.status })
      } catch (err) {
        results.push({ ...s, ok: false, error: err?.message ?? 'Failed' })
      }
    }
    res.status(201).json({ billed: results.filter((r) => r.ok).length, results })
  }),
)

router.post(
  '/:id/send',
  managers,
  handler(async (req, res) => res.json(await resumeSend(req.params.id))),
)

router.post(
  '/:id/void',
  admins,
  handler(async (req, res) => {
    const { reason } = parseBody(voidBody, req.body)
    res.json(await voidInvoice(req.params.id, reason))
  }),
)

export default router

/** Mounted under /residents/:id by the residents router. */
export function residentInvoiceRoutes(r) {
  r.get(
    '/:id/invoices',
    handler(async (req, res) => {
      const stayId = await activeStayIdFor(req.params.id)
      if (!stayId) return res.json({ invoices: [], unbilledCents: 0, unbilledCount: 0, stayId: null })
      res.json({ ...(await listInvoices(stayId)), stayId })
    }),
  )

  r.post(
    '/:id/invoices',
    requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER),
    handler(async (req, res) => {
      const { dueAt } = parseBody(sendBody, req.body ?? {})
      const stayId = await activeStayIdFor(req.params.id)
      if (!stayId) throw new HttpError(409, 'This resident has no active stay to bill.')
      const invoice = await sendInvoice(
        stayId,
        { dueAt: dueAt ? new Date(dueAt) : new Date() },
        req.session.userId,
      )
      res.status(201).json(invoice)
    }),
  )
}
