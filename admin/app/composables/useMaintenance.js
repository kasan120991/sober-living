/**
 * Maintenance requests.
 *
 * Split out of `useApartments` on 2026-08-07, when the module grew a lifecycle
 * of its own: a repair is work on a unit, not a property of one, and the two
 * had no more in common than the word "apartment".
 *
 * Every transition is its own route rather than a `PATCH` carrying a status,
 * because they do not share a rule — starting work is all-staff and defaults
 * the assignee to whoever tapped it, closing is managers and requires a note,
 * and raising a priority is all-staff while lowering it is not. One endpoint
 * would have to re-derive which of those it was from the body.
 *
 * Every mutation returns the whole request, refetched and reshaped by the
 * server, so a caller never patches local state and can never disagree with
 * the derived `state` the bell and dashboard read.
 */
export function useMaintenance() {
  const api = useApi()

  /** `{ status, apartmentId, priority }` — `status: 'open'` means both live states. */
  const listRequests = (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== ''),
    ).toString()
    return api(`/maintenance${qs ? `?${qs}` : ''}`).then((r) => r.requests)
  }

  /** The page's one composed read: `{ requests, figures, targetMs, at }`. */
  const houseMaintenance = () => api('/maintenance/house')

  const createRequest = (body) => api('/maintenance', { method: 'POST', body })

  /** No body takes it yourself. `{ assignedToId, vendorName, workOrderRef }` otherwise. */
  const startWork = (id, body = {}) =>
    api(`/maintenance/${id}/start`, { method: 'POST', body })

  /** `status` is RESOLVED or CANCELLED, and the note is required by the database. */
  const closeRequest = (id, body) => api(`/maintenance/${id}/close`, { method: 'POST', body })

  const reopenRequest = (id, body) => api(`/maintenance/${id}/reopen`, { method: 'POST', body })

  const setPriority = (id, priority) =>
    api(`/maintenance/${id}/priority`, { method: 'PATCH', body: { priority } })

  return {
    listRequests,
    houseMaintenance,
    createRequest,
    startWork,
    closeRequest,
    reopenRequest,
    setPriority,
  }
}
