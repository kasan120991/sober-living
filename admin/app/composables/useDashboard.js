/** The landing page's one read. See services/dashboard.js for the shape. */
export function useDashboard() {
  const api = useApi()

  const getDashboard = () => api('/dashboard')

  return { getDashboard }
}
