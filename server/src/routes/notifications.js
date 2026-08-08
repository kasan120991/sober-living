import { Router } from 'express'

import { handler } from '../lib/http.js'
import { requireAuth, requireStaff } from '../middleware/authorize.js'
import { feedFor, listNotifications, markSeen } from '../services/notifications.js'

const router = Router()

// Every staff role, because every item here is something any of them might be
// standing in front of. Residents are not staff and never reach this.
//
// WHICH staff role sees WHICH event is decided inside feedFor(), not here: the
// roles are per-event, so it is a `where` clause rather than a route guard.
router.use(requireAuth, requireStaff)

/**
 * ONE READ, TWO HALVES, and they are deliberately not two endpoints.
 *
 *   situations — derived, self-clearing, what is TRUE NOW. Read by the sidebar
 *                count badges. Unchanged by the event work.
 *   events     — stored, permanent, what JUST HAPPENED. What the bell renders.
 *
 * They ride together because `AppNotifications` is rendered by `AppPageHeader`
 * on every screen, so this endpoint already fires on every navigation and on
 * every socket `changed`. Splitting it would double the app's most frequent
 * request to serve one panel — and it is what keeps the sidebar badges from
 * going stale, since they are fed by the fetch the bell already makes.
 */
router.get(
  '/',
  handler(async (req, res) => {
    const [situations, feed] = await Promise.all([listNotifications(), feedFor(req.session)])
    res.json({ ...situations, ...feed })
  }),
)

/**
 * Mark this user's bell read, up to now.
 *
 * PER USER. A tech clearing their bell must not blind the manager, which is why
 * the watermark is keyed on the session's own userId and there is no way to
 * address anybody else's.
 *
 * IT BROADCASTS NOTHING — see SILENT_PREFIXES in app.js. Without that, one
 * person hovering their bell would fan `changed` out to every device in the
 * building and make every screen refetch its dashboard.
 */
router.post('/seen', handler(async (req, res) => res.json(await markSeen(req.session.userId))))

export default router
