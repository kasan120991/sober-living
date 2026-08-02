/**
 * The single figure in the header pill.
 *
 * Shared via useState so every page reads one request, and refreshed on the
 * same beat as the bell — navigation, and after any mutation that calls a
 * page's load(). Counts only, never names.
 */
export function useFacilityStatus() {
  const api = useApi()
  const status = useState('facility.status', () => null)

  async function refresh() {
    try {
      status.value = await api('/search/status')
    } catch {
      // Header chrome must never take a page down. Stale beats broken.
    }
  }

  return { status, refresh }
}
