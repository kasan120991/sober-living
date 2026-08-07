/**
 * The billing screen's one read.
 *
 * Managers and admins only — the API refuses a tech, and that refusal is the
 * protection. The sidebar hiding the link is presentation, as always.
 */
export function useBilling() {
  const api = useApi()

  /**
   * `{ figures, ready, skipped, readyTotalCents, sendableCount, pastDue,
   *    recent, nag }` — one request, so no two bands can disagree.
   */
  const getBilling = () => api('/billing')

  return { getBilling }
}
