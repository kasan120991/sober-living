/**
 * Sign-outs: departures, returns, and the mistake eraser.
 *
 * Times cross the wire as wall-clock strings ('HH:MM' + optional
 * 'YYYY-MM-DD') and the SERVER interprets them in the facility timezone —
 * a manager recording from home in another timezone still writes facility
 * time. Responses carry UTC instants; display goes through
 * utils/facilityTime.js.
 */
export function useSignOuts() {
  const api = useApi()

  /** Returns { open, returned } — open sorted most-overdue first. */
  const listSignOuts = () => api('/sign-outs')

  const recordSignOut = (body) => api('/sign-outs', { method: 'POST', body })

  const acknowledgeReturn = (id, body = {}) =>
    api(`/sign-outs/${id}/return`, { method: 'POST', body })

  /** Open records only — a completed return is history the API refuses to drop. */
  const removeSignOut = (id) => api(`/sign-outs/${id}`, { method: 'DELETE' })

  return { listSignOuts, recordSignOut, acknowledgeReturn, removeSignOut }
}
