/**
 * The bell, and the toasts that come with it.
 *
 * ONE READ, TWO HALVES (2026-08-09):
 *   situations — derived, self-clearing, what is TRUE NOW. The bell no longer
 *                renders these; the sidebar count badges do, via useNavBadges,
 *                and the dashboard shows the same facts in its own panels.
 *   events     — stored, permanent, what JUST HAPPENED. This is the bell.
 *
 * Shared via `useState`, so every page renders the same counts from one request
 * rather than each screen fetching its own. Refreshed on navigation, when the
 * panel opens, and on every realtime `changed`.
 *
 * THE SOCKET STILL CARRIES NOTHING. A toast is not pushed — the socket says
 * "something changed", this refetches, and a toast is what is NEW in the
 * result. Which is why per-subscriber authorization never had to be invented:
 * the server decided what this session may see when it answered the GET.
 */

// ── Toast bookkeeping: module scope, deliberately NOT useState ──────────────
//
// THE BADGE AND THE TOAST ANSWER DIFFERENT QUESTIONS, and conflating them is
// the bug this separation exists to prevent:
//
//   the badge — "have I looked at my bell since this arrived": server-side,
//               durable, CROSS-DEVICE (`seenAt`).
//   the toast — "has THIS TAB already shown me this": client-side, ephemeral,
//               PER-TAB.
//
// Share a mechanism between them and marking seen on your desktop silently
// kills the toast on your phone.
let armed = false
const toasted = new Set()

/** A toast is an interruption about NOW. Older than this and the badge has it. */
const TOAST_MAX_AGE_MS = 5 * 60_000
/** More than this at once and they stack off-screen — one summary instead. */
const TOAST_BURST_MAX = 3
const TOASTED_CAP = 200

export function useNotifications() {
  const api = useApi()
  const { user } = useAuth()
  const notify = useNotify()

  const situations = useState('notifications.situations', () => [])
  const actionCount = useState('notifications.count', () => 0)
  const events = useState('notifications.events', () => [])
  const unseenCount = useState('notifications.unseen', () => 0)
  const loaded = useState('notifications.loaded', () => false)

  async function refresh() {
    try {
      const data = await api('/notifications')
      situations.value = data.situations
      actionCount.value = data.actionCount
      events.value = data.events
      unseenCount.value = data.unseenCount
      loaded.value = true
      toastNew(data.events)
    } catch {
      // A failing bell must never take a page down with it. Staying silent is
      // right here: the counts simply stop updating.
      loaded.value = true
    }
  }

  /**
   * Toast whatever is genuinely new, genuinely recent, and genuinely somebody
   * else's doing.
   */
  function toastNew(list) {
    // A COLD LOAD TOASTS NOTHING. They were already there when you arrived, and
    // announcing the last fortnight because somebody opened a laptop is how a
    // toast stops meaning "this just happened".
    if (!armed) {
      for (const e of list) toasted.add(e.id)
      armed = true
      return
    }

    const now = Date.now()
    const fresh = []
    for (const e of list) {
      if (toasted.has(e.id)) continue
      // Marked BEFORE any further work, so a navigation refresh and a socket
      // refresh landing together cannot double-toast the same event.
      toasted.add(e.id)
      // YOUR OWN ACT IS NOT NEWS TO YOU. You pressed Save and the dialog
      // already told you; a second toast is the app talking back. This is the
      // only thing actorId is for — the event still appears in the feed,
      // because a record of what happened includes your own acts.
      if (e.actorId && e.actorId === user.value?.id) continue
      // THE RECONNECT GUARD. A tab asleep three hours reconnects, useRealtime
      // refetches, thirty events arrive — and every one is stale. Zero toasts;
      // the badge carries them instead, which is exactly what a badge is for.
      if (now - new Date(e.at).getTime() > TOAST_MAX_AGE_MS) continue
      fresh.push(e)
    }

    if (toasted.size > TOASTED_CAP) {
      for (const id of [...toasted].slice(0, toasted.size - TOASTED_CAP)) toasted.delete(id)
    }

    if (!fresh.length) return
    // The dashboard's own rolls-cap reasoning: thirty rows bury the one that
    // matters. Thirty toasts bury it AND stack off the screen.
    if (fresh.length > TOAST_BURST_MAX) {
      notify.info(`${fresh.length} new notifications`)
      return
    }
    for (const e of fresh) toastFor(e).call(notify, e.title, e.detail ?? undefined)
  }

  /**
   * Tone from the CLASS, not the kind — six kinds, three families. Safety is
   * the only one that gets the loud one; money and requests are things to do,
   * not things that are wrong.
   */
  function toastFor(e) {
    if (e.class === 'SAFETY') return notify.error
    if (e.class === 'MONEY') return notify.success
    return notify.info
  }

  /**
   * Mark this user's bell read. Per user — it does not clear anybody else's.
   *
   * Skipped when there is nothing unseen, or a shared house phone POSTs on
   * every bell hover. The response carries the new count, so nothing refetches
   * — and the route deliberately broadcasts nothing (SILENT_PREFIXES in
   * app.js), or one person opening a bell would make every screen in the
   * building refetch its dashboard.
   */
  async function markSeen() {
    if (!unseenCount.value) return
    try {
      const data = await api('/notifications/seen', { method: 'POST' })
      unseenCount.value = data.unseenCount
    } catch {
      // Same posture as refresh: the bell never takes a page down.
    }
  }

  return { situations, actionCount, events, unseenCount, loaded, refresh, markSeen }
}
