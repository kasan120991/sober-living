/**
 * Drug screen vocabulary — COPIED from server/src/domain/constants.js, not
 * imported across folders, per the convention in CLAUDE.md.
 *
 * `effectiveResult` and `contradicted` are deliberately absent: they come from
 * the server on every read. Two implementations of "what did this screen find"
 * is how two screens come to disagree about a person's result — the
 * `servicePace()` lesson, and it matters more here than anywhere.
 */
import { toneClass } from '~/utils/schedule.js'

export const SCREEN_RESULT = Object.freeze({
  NEGATIVE: 'NEGATIVE',
  POSITIVE: 'POSITIVE',
  REFUSAL: 'REFUSAL',
  DILUTE: 'DILUTE',
  PENDING: 'PENDING',
})

export const CONFIRMATION_STATUS = Object.freeze({
  NOT_OFFERED: 'NOT_OFFERED',
  PENDING_DECISION: 'PENDING_DECISION',
  DECLINED: 'DECLINED',
  REQUESTED: 'REQUESTED',
  RETURNED: 'RETURNED',
})

export const SCREEN_REASONS = [
  { label: 'Random', value: 'RANDOM' },
  { label: 'For cause', value: 'FOR_CAUSE' },
]

export const SCREEN_METHODS = [
  { label: 'Urine', value: 'URINE' },
  { label: 'Oral fluid', value: 'ORAL_FLUID' },
  { label: 'Breath', value: 'BREATH' },
]

export const SUBSTANCES = [
  'ALCOHOL', 'AMPHETAMINES', 'BARBITURATES', 'BENZODIAZEPINES', 'BUPRENORPHINE',
  'COCAINE', 'FENTANYL', 'MDMA', 'METHADONE', 'METHAMPHETAMINE', 'OPIATES',
  'OXYCODONE', 'PCP', 'THC', 'OTHER',
]

/** 'BENZODIAZEPINES' → 'Benzodiazepines'; 'ORAL_FLUID' → 'Oral fluid'. */
export function humanEnum(v) {
  if (!v) return ''
  const s = v.replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * How a result reads and which tone it carries.
 *
 * REFUSAL and DILUTE are WARNING, not destructive — the reason the theme
 * carries `--warning` beside `--destructive` at all (UI rules). Collapsing
 * them into red is exactly the "just fail" this module refuses.
 */
export function resultDisplay(result) {
  if (result === SCREEN_RESULT.NEGATIVE) return { label: 'Negative', tone: 'success' }
  if (result === SCREEN_RESULT.POSITIVE) return { label: 'Positive', tone: 'destructive' }
  if (result === SCREEN_RESULT.REFUSAL) return { label: 'Refusal', tone: 'warning' }
  if (result === SCREEN_RESULT.DILUTE) return { label: 'Dilute', tone: 'warning' }
  // Not "Pending" — that is the word for a specimen at the lab, and these are
  // two different waits. See the enum comment in schema.prisma.
  if (result === SCREEN_RESULT.PENDING) return { label: 'Not read', tone: 'muted' }
  return { label: humanEnum(result), tone: 'muted' }
}

/** Where a screen sits in the arc, in words a hallway understands. */
export function confirmationDisplay(status) {
  if (status === CONFIRMATION_STATUS.PENDING_DECISION) return { label: 'Decision due', tone: 'warning' }
  if (status === CONFIRMATION_STATUS.DECLINED) return { label: 'Confirmation declined', tone: 'muted' }
  if (status === CONFIRMATION_STATUS.REQUESTED) return { label: 'At the lab', tone: 'muted' }
  if (status === CONFIRMATION_STATUS.RETURNED) return { label: 'Confirmed', tone: 'muted' }
  return { label: '', tone: 'muted' }
}

export { toneClass }
