/**
 * Apartment checks: the hourly round.
 *
 * Responses carry UTC instants plus facility hour keys ('2026-08-06 14');
 * display goes through utils/facilityTime.js (formatHourLabel, checkState).
 * The client never sends a time — checkedAt is always the server clock.
 */
export function useChecks() {
  const api = useApi()

  /** One read: { now, hour, figures, apartments, log }. */
  const getChecks = () => api('/checks')

  /** Who should be accounted for right now: { apartment, people }. */
  const getRoster = (apartmentId) => api(`/checks/roster/${apartmentId}`)

  /** One check in full — the amend sheet's read. */
  const getCheck = (id) => api(`/checks/${id}`)

  const recordCheck = (body) => api('/checks', { method: 'POST', body })

  /** A correction is an amendment; the original stays. */
  const amendCheck = (id, body) => api(`/checks/${id}/amend`, { method: 'POST', body })

  /**
   * One resident's trail: { hasActiveStay, status, lines, nextCursor }.
   * `date` shows one facility day; `cursor` pages the open-ended trail.
   */
  const getResidentChecks = (residentId, { date, cursor } = {}) => {
    const q = new URLSearchParams()
    if (date) q.set('date', date)
    if (cursor) q.set('cursor', cursor)
    const qs = q.toString()
    return api(`/residents/${residentId}/checks${qs ? `?${qs}` : ''}`)
  }

  return { getChecks, getRoster, getCheck, recordCheck, amendCheck, getResidentChecks }
}
