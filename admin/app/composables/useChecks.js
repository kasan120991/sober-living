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

  return { getChecks, getRoster, getCheck, recordCheck, amendCheck }
}
