/**
 * Community service hours.
 *
 * Hours cross the wire as a decimal a human typed ("3.5"); the SERVER parses
 * them to integer minutes, so one rounding rule applies to everyone. Nothing
 * here multiplies by 60 — the same reason the ledger sends dollars as a string.
 */
export function useServiceHours() {
  const api = useApi()

  /**
   * The house-wide page: `{ pending, progress, figures }` in one read.
   * `pending` is oldest work first; `progress` puts whoever is furthest behind
   * at the top.
   */
  const getHouseService = () => api('/service')

  /** Current entries for the active stay — superseded ones are already gone. */
  const listEntries = (residentId) => api(`/residents/${residentId}/service`)

  const logHours = (residentId, body) =>
    api(`/residents/${residentId}/service`, { method: 'POST', body })

  /** The one transition this table allows. All staff, deliberately. */
  const verifyEntry = (entryId) => api(`/service/${entryId}/verify`, { method: 'POST' })

  /**
   * A correction: a NEW entry pointing at the one it fixes. Anything omitted
   * carries over from the original. `amendmentReason` is required — the
   * database refuses an amendment without one.
   */
  const amendEntry = (entryId, body) => api(`/service/${entryId}/amend`, { method: 'POST', body })

  /** Whole hours, or null to fall back to the phase default. Managers only. */
  const setTarget = (residentId, hours) =>
    api(`/residents/${residentId}/service-target`, { method: 'PATCH', body: { hours } })

  return { getHouseService, listEntries, logHours, verifyEntry, amendEntry, setTarget }
}
