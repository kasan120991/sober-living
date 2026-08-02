/**
 * Residents: the roster, the record, and the events that change a stay.
 *
 * Intake, discharge and bed moves all mutate more than one table, so they are
 * single API calls rather than orchestrated here — the server does them in one
 * transaction and the client never sees a half-built resident.
 */
export function useResidents() {
  const api = useApi()

  /** Returns { residents, capacity, unhoused } — the header renders from the
   *  same request as the table rather than firing extra round trips. */
  const listResidents = (includeDischarged = false) =>
    api(`/residents${includeDischarged ? '?includeDischarged=true' : ''}`)

  const getResident = (id) => api(`/residents/${id}`)
  const intakeResident = (body) => api('/residents', { method: 'POST', body })
  const updateResident = (id, body) => api(`/residents/${id}`, { method: 'PATCH', body })

  const dischargeResident = (id, body) =>
    api(`/residents/${id}/discharge`, { method: 'POST', body })

  const assignBed = (id, bedId) => api(`/residents/${id}/bed`, { method: 'POST', body: { bedId } })
  const releaseBed = (id, reason) =>
    api(`/residents/${id}/bed`, { method: 'DELETE', body: { reason } })

  const availableBeds = (cohort) =>
    api(`/residents/available-beds?cohort=${cohort}`).then((r) => r.beds)

  /** Every line on the resident's active stay, newest first, plus the balance. */
  const listLedger = (id) => api(`/residents/${id}/ledger`)

  /** `amount` goes over as the string a human typed; the server parses it to
   *  cents. Multiplying by 100 in the browser loses a cent on values like
   *  12.10, and a ledger that is off by cents cannot be reconciled. */
  const postLedgerEntry = (id, body) => api(`/residents/${id}/ledger`, { method: 'POST', body })

  const addContact = (id, body) => api(`/residents/${id}/contacts`, { method: 'POST', body })
  const removeContact = (contactId) =>
    api(`/residents/contacts/${contactId}`, { method: 'DELETE' })

  return {
    listResidents,
    getResident,
    intakeResident,
    updateResident,
    dischargeResident,
    assignBed,
    releaseBed,
    availableBeds,
    listLedger,
    postLedgerEntry,
    addContact,
    removeContact,
  }
}

export const DISCHARGE_TYPES = [
  { label: 'Successful', value: 'SUCCESSFUL' },
  { label: 'Left against advice (AMA)', value: 'AMA' },
  { label: 'Administrative', value: 'ADMINISTRATIVE' },
  { label: 'Transfer', value: 'TRANSFER' },
]

/** ISO date → "2026-05-01". Dates are shown in mono, so keep them fixed-width. */
export function isoDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : null
}
