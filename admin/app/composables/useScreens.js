/**
 * Drug screens — module 5.
 *
 * Note what `getScreens` does NOT return: results, substances, lab results.
 * The queue carries no outcomes at all, and revealing a row calls
 * `getScreen(id)`. That is deliberate — it makes the reveal an authorization
 * and audit boundary rather than a curtain drawn over data the browser was
 * already sent, and it keeps the audit log able to answer "who looked at
 * whose result".
 */
export function useScreens() {
  const api = useApi()

  /** The work queue: `{ feeCents, figures, bands }`. No outcomes. */
  const getScreens = () => api('/screens')

  /** ONE screen, WITH its outcome. This is the reveal. */
  const getScreen = (id) => api(`/screens/${id}`)

  const recordScreen = (body) => api('/screens', { method: 'POST', body })

  /** The resident's answer. `REQUESTED` also posts the lab fee, server-side. */
  const recordDecision = (id, body) => api(`/screens/${id}/decision`, { method: 'POST', body })

  const recordLabResult = (id, body) => api(`/screens/${id}/lab`, { method: 'POST', body })

  const amendScreen = (id, body) => api(`/screens/${id}/amend`, { method: 'POST', body })

  /** The resident record's section — outcome-free, same as the queue. */
  const getResidentScreens = (residentId) => api(`/residents/${residentId}/screens`)

  // Colleagues, for the witness picker. Lives in useStaff() since 2026-08-07 —
  // maintenance needed the same picker — and is re-exported here so every
  // existing caller keeps working.
  const { listStaff } = useStaff()

  return {
    getScreens,
    getScreen,
    recordScreen,
    recordDecision,
    recordLabResult,
    amendScreen,
    getResidentScreens,
    listStaff,
  }
}
