/**
 * Invoices — module 11's second half.
 *
 * Amounts are integer cents in both directions, like the rest of the money in
 * this app. `dueAt` is optional because invoices are due on receipt; it exists
 * so a manager can agree different terms on one invoice without a new endpoint.
 */
export function useInvoices() {
  const api = useApi()

  /** `{ invoices, balanceCents, pendingCents, draftCents, overdue, dotDue, stayId }`. */
  const listInvoices = (residentId) => api(`/residents/${residentId}/invoices`)

  /** Sweep this resident's PENDING lines into one invoice and send it. */
  const sendInvoice = (residentId, body = {}) =>
    api(`/residents/${residentId}/invoices`, { method: 'POST', body })

  /** Who has something worth billing — what the Friday run would act on. */
  const listBillable = () => api('/invoices/billable').then((r) => r.stays)

  /** The Friday button: one invoice per active stay with a positive net. */
  const runWeekly = () => api('/invoices/weekly-run', { method: 'POST', body: {} })

  /** Retry the Stripe half of a draft whose send did not finish. */
  const resendInvoice = (id) => api(`/invoices/${id}/send`, { method: 'POST', body: {} })

  /** Admins only. A void strands its lines permanently — they never re-bill. */
  const voidInvoice = (id, reason) => api(`/invoices/${id}/void`, { method: 'POST', body: { reason } })

  return { listInvoices, sendInvoice, listBillable, runWeekly, resendInvoice, voidInvoice }
}
