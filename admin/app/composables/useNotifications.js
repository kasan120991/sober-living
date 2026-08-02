/**
 * The bell.
 *
 * Shared state via `useState`, so every page renders the same count from one
 * request rather than each screen fetching its own. Refreshed on navigation and
 * when the panel opens — there is no timer, because a staff phone sitting on a
 * counter does not need to poll, and the moments that matter (opening the app,
 * moving between screens, checking the bell) are all covered.
 *
 * Everything it returns is derived server-side from current state. Nothing is
 * stored, so nothing can be marked read — see server/src/services/notifications.js
 * for why that is deliberate.
 */
export function useNotifications() {
  const api = useApi()
  const items = useState('notifications.items', () => [])
  const actionCount = useState('notifications.count', () => 0)
  const loaded = useState('notifications.loaded', () => false)

  async function refresh() {
    try {
      const data = await api('/notifications')
      items.value = data.items
      actionCount.value = data.actionCount
      loaded.value = true
    } catch {
      // A failing bell must never take a page down with it. Staying silent is
      // right here: the count simply stops updating.
      loaded.value = true
    }
  }

  return { items, actionCount, loaded, refresh }
}
