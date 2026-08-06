/**
 * The census: one request for the whole landing page — figures, apartments
 * with their beds and occupants, and whoever is awaiting a bed.
 */
export function useCensus() {
  const api = useApi()

  /** Returns { figures, apartments, unhoused }. */
  const getCensus = () => api('/census')

  return { getCensus }
}
