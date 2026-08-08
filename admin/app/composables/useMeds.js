/**
 * Med pass — observed self-administration.
 *
 * Two reads, deliberately shaped differently and worth knowing before adding a
 * third: `getMeds` is the BOARD and carries no medication name at all; a drug
 * only ever arrives through `getPass`, one resident at a time, because somebody
 * opened their sheet. That split is the module's privacy boundary and it lives
 * on the server — there is nothing to hide client-side because there is nothing
 * on the wire to hide.
 */
export function useMeds() {
  const api = useApi()

  /** The board: `{ now, date, figures, passes }`. Counts and names, no drugs. */
  const getMeds = (date) => api(`/meds${date ? `?date=${date}` : ''}`)

  /** ONE resident's doses, WITH their medications. The deliberate open. */
  const getPass = (stayId, date) =>
    api(`/meds/pass/${stayId}${date ? `?date=${date}` : ''}`)

  /** One POST for a whole resident's pass, never one per dose. */
  const recordDoses = (body) => api('/meds/logs', { method: 'POST', body })

  /** An as-needed dose, which answers no scheduled slot. */
  const recordPrnDose = (body) => api('/meds/logs/prn', { method: 'POST', body })

  const amendDose = (id, body) => api(`/meds/logs/${id}/amend`, { method: 'POST', body })

  /** The resident record's section: the list plus a keyset-paged dose trail. */
  const getResidentMeds = (residentId, { date, cursor } = {}) => {
    const q = new URLSearchParams()
    if (date) q.set('date', date)
    if (cursor) q.set('cursor', cursor)
    const qs = q.toString()
    return api(`/residents/${residentId}/meds${qs ? `?${qs}` : ''}`)
  }

  // ── The med list. Managers only at the server; the UI hides rather than
  // disables, and the API refuses regardless.
  const addMedication = (residentId, body) =>
    api(`/residents/${residentId}/medications`, { method: 'POST', body })
  const editMedication = (id, body) =>
    api(`/meds/medications/${id}`, { method: 'PATCH', body })
  const discontinueMedication = (id, body) =>
    api(`/meds/medications/${id}/discontinue`, { method: 'POST', body })
  const deleteMedication = (id) => api(`/meds/medications/${id}`, { method: 'DELETE' })

  // The observing-staff picker's source. Module 5 built GET /staff for its
  // witness picker and CLAUDE.md named med pass as its second consumer; this is
  // that. Re-exported so a caller needs one composable, not two.
  const { listStaff } = useStaff()

  return {
    getMeds,
    getPass,
    recordDoses,
    recordPrnDose,
    amendDose,
    getResidentMeds,
    addMedication,
    editMedication,
    discontinueMedication,
    deleteMedication,
    listStaff,
  }
}
