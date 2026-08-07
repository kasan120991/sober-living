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
  // Net 3 days is the facility's term, applied by the service, so this is
  // optional. It stays overridable because a manager occasionally agrees
  // different terms on one invoice.
  dueAt: z.string().datetime().optional(),
})
const voidBody = z.object({ reason: z.string().trim().min(1).max(300) })

/**
 * Who has something worth billing — what the Friday button acts on.
 *
 * MANAGERS, tightened 2026-08-07 when the billing screen was built. It had been
 * all-staff, which was an oversight rather than a decision: only manager UI has
 * ever called it, and a facility-wide money read that a tech could fetch sat
 * oddly beside a screen they cannot open. The per-resident ledger read is the
 * one deliberately left all-staff.
 */
router.get(
  '/billable',
  managers,
  handler(async (_req, res) => res.json({ stays: await billableStays() })),
)

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
        // No dueAt: the service applies the facility's payment term, so the
        // Friday run and a one-off send cannot disagree about what it is.
        const invoice = await sendInvoice(s.stayId, {}, req.session.userId)
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
      if (!stayId) return res.json({ invoices: [], pendingCents: 0, pendingCount: 0, stayId: null })
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
      // Omitted rather than defaulted: the term lives in the service.
      const invoice = await sendInvoice(
        stayId,
        { dueAt: dueAt ? new Date(dueAt) : undefined },
        req.session.userId,
      )
      res.status(201).json(invoice)
    }),
  )
}
