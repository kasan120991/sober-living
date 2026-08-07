/**
 * Maintenance display rules — the `invoiceStatusDisplay()` /
 * `sessionStateDisplay()` pattern, which this module did nothing with until
 * 2026-08-07.
 *
 * Everything here used to be inlined in `AppMaintenanceList.vue`: `OPEN_STATES`
 * as a local array, the resolved/cancelled label as a ternary in the template,
 * and a local date formatter. Three copies of "what does closed look like" is
 * how a list and a dashboard row come to disagree.
 */

export const MAINTENANCE_STATUS = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED',
})

export const MAINTENANCE_PRIORITY = Object.freeze({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  URGENT: 'URGENT',
})

/// Derived on the server by `requestState()`, never stored. Mirrored here only
/// as a vocabulary — the client does NOT re-derive it, so a row and the bell
/// cannot disagree about what is late.
export const MAINTENANCE_STATE = Object.freeze({
  OPEN: 'OPEN',
  OVERDUE: 'OVERDUE',
  CLOSED: 'CLOSED',
})

export const OPEN_STATUSES = Object.freeze([
  MAINTENANCE_STATUS.OPEN,
  MAINTENANCE_STATUS.IN_PROGRESS,
])

export const isOpen = (r) => OPEN_STATUSES.includes(r?.status)

/**
 * What a request's situation reads as.
 *
 * OVERDUE is destructive and IN_PROGRESS is muted rather than coloured: work
 * somebody has picked up is the system behaving, and colouring it would put a
 * third signal on a screen whose one alarm is "nobody has dealt with this."
 */
export function requestStateDisplay(r) {
  if (r?.state === MAINTENANCE_STATE.OVERDUE) return { label: 'Overdue', tone: 'destructive' }
  if (r?.status === MAINTENANCE_STATUS.RESOLVED) return { label: 'Resolved', tone: 'muted' }
  if (r?.status === MAINTENANCE_STATUS.CANCELLED) return { label: 'Cancelled', tone: 'muted' }
  if (r?.status === MAINTENANCE_STATUS.IN_PROGRESS) return { label: 'In progress', tone: 'muted' }
  return { label: 'Open', tone: 'none' }
}

/**
 * URGENT is the only coloured priority, and that rule predates this file —
 * normal and low are the ordinary case and stay achromatic.
 *
 * It is `--warning`, not `--destructive`: red on this screen means *past its
 * target*, and an urgent request filed ten minutes ago is not late. Using one
 * colour for both would make "urgent" and "overdue" indistinguishable at a
 * glance, which is the whole judgement the page exists to support.
 */
export function priorityDisplay(priority) {
  if (priority === MAINTENANCE_PRIORITY.URGENT) return { label: 'Urgent', tone: 'warning' }
  if (priority === MAINTENANCE_PRIORITY.LOW) return { label: 'Low', tone: 'none' }
  return { label: 'Normal', tone: 'none' }
}

/**
 * Who owns the job, as one line. Both may be set — a manager who owns it and
 * called a plumber is one request — so this joins rather than choosing.
 * Returns null when nobody does, so a caller renders nothing rather than "—".
 */
export function ownerLabel(r) {
  const parts = []
  if (r?.assignedTo?.fullName) parts.push(r.assignedTo.fullName)
  if (r?.vendorName) parts.push(r.workOrderRef ? `${r.vendorName} · ${r.workOrderRef}` : r.vendorName)
  return parts.length ? parts.join(' · ') : null
}

/**
 * "2 days", "3 hours", "just now" — how long the thing has been broken.
 *
 * Coarse on purpose. The precise instant is in the tooltip; what a queue needs
 * is the order of magnitude, and "1 day 4 hours" invites reading a number that
 * carries no decision.
 */
export function ageLabel(reportedAt, now = new Date()) {
  if (!reportedAt) return ''
  const ms = now.getTime() - new Date(reportedAt).getTime()
  if (ms < 60 * 60_000) return 'just now'
  const hours = Math.floor(ms / (60 * 60_000))
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/// A closure or reopening, as a sentence opener.
export function eventLabel(e) {
  if (e?.kind === 'REOPENED') return 'Reopened'
  return e?.closedAs === MAINTENANCE_STATUS.CANCELLED ? 'Cancelled' : 'Closed'
}

// Deliberately NO `export { toneClass }`. It is auto-imported from
// utils/schedule.js already; re-exporting it is what makes Nuxt print
// "Duplicated imports 'toneClass'" at boot, which utils/screens.js already
// does once. Two is a warning, three is a habit.
