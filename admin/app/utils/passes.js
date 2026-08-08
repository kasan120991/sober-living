/**
 * Travel pass display, and the client half of the overdue knob.
 *
 * `PASS_GRACE_MS` is a COPY of the server's figure in domain/constants.js — the
 * FACILITY_TIMEZONE arrangement, since the frontends never import across
 * folders. It exists client-side for one reason: a pass crossing into overdue
 * is no write, so no socket event will come, and the page's clock tick has to
 * re-derive it locally. The SERVER's figure is authoritative.
 *
 * It is DEFINED in utils/facilityTime.js beside the sign-out and check graces,
 * because presenceState() there needs it. This file only imports it.
 *
 * It is deliberately NOT re-exported from here, which it briefly was: Nuxt
 * auto-imports every name `utils/` exports, so two modules exporting one name
 * is a registry collision — the build warns "Duplicated imports PASS_GRACE_MS"
 * and silently picks a winner. Harmless while both are the same number, and
 * exactly the kind of thing that stops being harmless later. Nothing outside
 * this file wanted the re-export anyway; auto-import already gives every screen
 * the constant from its one home.
 */
import { PASS_GRACE_MS } from '~/utils/facilityTime.js'

/** Mirrors the server: an approved pass past its return time plus the grace. */
export const passOverdue = (pass, nowMs = Date.now()) =>
  pass.status === 'APPROVED' && new Date(pass.returnBy).getTime() < nowMs - PASS_GRACE_MS

/**
 * How each state reads. Tones come from the same scale toneClass() serves.
 *
 * DENIED is `muted`, not `destructive` — a refusal is an ordinary outcome of a
 * review, not a fault, and colouring it red would make every declined request
 * look like an incident. Only an overdue return earns the red, because only it
 * means somebody is unaccounted for.
 */
export const PASS_DISPLAY = Object.freeze({
  REQUESTED: { label: 'Requested', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  DENIED: { label: 'Denied', tone: 'muted' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
  RETURNED: { label: 'Returned', tone: 'success' },
})

export const passDisplay = (status) =>
  PASS_DISPLAY[status] ?? { label: status, tone: 'muted' }

/** "2 nights", "1 night" — the figure a reviewer actually weighs. */
export const nightsLabel = (n) => `${n} ${n === 1 ? 'night' : 'nights'}`
