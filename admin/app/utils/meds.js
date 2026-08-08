/**
 * Med pass display, and the client half of the one knob.
 *
 * `MED_PASS_GRACE_MS` is a COPY of the server's figure in
 * server/src/domain/constants.js, the same arrangement as FACILITY_TIMEZONE and
 * checkState(): the frontends never import across folders. It exists here for
 * one reason only — a dose crossing from DUE into MISSED is no write, so no
 * socket event will come, and the board's clock tick has to re-derive it
 * locally. The SERVER's figure is authoritative for anything recorded.
 */
export const MED_PASS_GRACE_MS = 2 * 60 * 60_000

/**
 * One dose's standing. Mirrors doseStateOf() in services/meds.js exactly — a
 * recorded log always wins, because it is an observation and no clock overrules
 * it. Two implementations is how the tile and the figure come to disagree, so
 * if the server's rule changes this must change with it.
 */
export function doseState(scheduledFor, log, nowMs = Date.now()) {
  if (log) return log.status
  const at = new Date(scheduledFor).getTime()
  if (at > nowMs) return 'UPCOMING'
  if (at >= nowMs - MED_PASS_GRACE_MS) return 'DUE'
  return 'MISSED'
}

/**
 * How each state reads. Tones come from the same scale toneClass() serves in
 * utils/schedule.js, and the split between them is load-bearing:
 *
 *   REFUSED is `warning`, never `destructive`. It is a resident exercising a
 *   choice and a fact that DEFENDS the facility — the same reasoning that keeps
 *   a refused drug screen off the red. MISSED is destructive because it is the
 *   facility failing to observe a dose at all.
 */
export const MED_STATE_DISPLAY = Object.freeze({
  UPCOMING: { label: 'Not due yet', short: 'Later', tone: 'muted' },
  DUE: { label: 'Due now', short: 'Due', tone: 'warning' },
  GIVEN: { label: 'Given', short: 'Given', tone: 'success' },
  REFUSED: { label: 'Refused', short: 'Refused', tone: 'warning' },
  HELD: { label: 'Held', short: 'Held', tone: 'warning' },
  MISSED: { label: 'Missed', short: 'Missed', tone: 'destructive' },
})

export const medStateDisplay = (state) =>
  MED_STATE_DISPLAY[state] ?? { label: state, short: state, tone: 'muted' }

/** The three a human can record. MISSED is deliberately absent — see the enum. */
export const RECORDABLE = Object.freeze(['GIVEN', 'REFUSED', 'HELD'])

/** Only GIVEN needs no explanation; a departure from the instruction does. */
export const needsReason = (status) => status === 'REFUSED' || status === 'HELD'

/**
 * A pass's own standing from the counts the server sends. DUE beats MISSED: a
 * pass with one of each still has something somebody can act on.
 */
export function passState(pass) {
  if (pass.due) return 'DUE'
  if (pass.missed) return 'MISSED'
  return pass.marked === pass.total ? 'GIVEN' : 'UPCOMING'
}

/** "1 tablet · with food" — the two label facts, when both exist. */
export function doseLine(dose) {
  return [dose.dosage, dose.instructions].filter(Boolean).join(' · ')
}
