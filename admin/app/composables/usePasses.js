/**
 * Travel passes — an overnight or multi-day approved absence.
 *
 * Note what the board carries and what it does not: `/passes` is a WORK QUEUE,
 * so it names residents and carries destinations, exactly as the sign-outs page
 * does. The census tile still withholds the destination, because that board is
 * glanced at with residents around.
 */
export function usePasses() {
  const api = useApi()

  /** The board: `{ figures, awaitingReview, away, recent }`. */
  const getPasses = () => api('/passes')

  /** Filing is all-staff and addressed by resident — eligibility hangs off their stay. */
  const requestPass = (residentId, body) =>
    api(`/residents/${residentId}/passes`, { method: 'POST', body })

  /** Managers only; a denial needs a note and the server refuses without one. */
  const reviewPass = (id, body) => api(`/passes/${id}/review`, { method: 'POST', body })

  const returnPass = (id) => api(`/passes/${id}/return`, { method: 'POST' })
  const cancelPass = (id, body) => api(`/passes/${id}/cancel`, { method: 'POST', body })
  const withdrawPass = (id) => api(`/passes/${id}`, { method: 'DELETE' })

  /** The record's section — passes plus WHY a request would be refused. */
  const getResidentPasses = (residentId) => api(`/residents/${residentId}/passes`)

  return {
    getPasses,
    requestPass,
    reviewPass,
    returnPass,
    cancelPass,
    withdrawPass,
    getResidentPasses,
  }
}
