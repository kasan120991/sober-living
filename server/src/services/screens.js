import { prisma, runInTransaction } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import {
  CONFIRMATION_STATUS,
  LAB_CONFIRMATION_FEE_CENTS,
  LEDGER_CATEGORY,
  LEDGER_ENTRY_TYPE,
  SCREEN_RESULT,
  STAY_STATUS,
} from '../domain/constants.js'
import { postEntry } from './ledger.js'

/**
 * Drug screens — module 5.
 *
 * A cup is read on site. On a confirmable non-negative the RESIDENT decides
 * whether the specimen goes to a lab, and pays LAB_CONFIRMATION_FEE_CENTS if
 * they do. Their answer either way is the record: "he was offered confirmation
 * and declined" is exactly the claim this module exists to be able to prove.
 *
 * Two rules govern everything here:
 *
 *   - THE COLLECTION IS IMMUTABLE. A mistake is corrected by an AMENDMENT.
 *   - THE LAB IS AUTHORITATIVE AND THE CUP SURVIVES. Nothing overwrites
 *     `result`; a contradiction is two facts, and the second does not unmake
 *     the first.
 *
 * NOTHING here is consumed by services/notifications.js or dashboard.js, and
 * that is structural rather than incidental — see the note on
 * screenSummaryForStay below. /screens is the only surface.
 */

/** The current view: screens no amendment has superseded. */
const CURRENT_ONLY = { supersededBy: { is: null } }

/** Confirmation is only offered where there is a specimen worth confirming. */
const CONFIRMABLE = [SCREEN_RESULT.POSITIVE, SCREEN_RESULT.DILUTE]

/** What a lab may report. It cannot refuse, and it is never "not read". */
const LAB_VOCABULARY = [SCREEN_RESULT.NEGATIVE, SCREEN_RESULT.POSITIVE, SCREEN_RESULT.DILUTE]

/**
 * `screenSummaryForStay()` DELIBERATELY DOES NOT EXIST, and this comment is
 * the reason. It is the function somebody would write to hang a dot on the
 * resident record's rail or a count on the bell — and module 13's "separate
 * think" was done on 2026-08-06 and came back: nothing from screens reaches
 * the bell or the dashboard, not a name and not a count.
 */

const NAME = { select: { id: true, firstName: true, lastName: true } }
const WHO = { select: { id: true, fullName: true } }
const WITH_PEOPLE = {
  stay: { select: { id: true, resident: NAME } },
  witnessedBy: WHO,
  recordedBy: WHO,
  decisionRecordedBy: WHO,
  labRecordedBy: WHO,
}

/**
 * What this screen found, and whether its two halves agree.
 *
 * DERIVED on every read, never stored — the PRESENCE / CHECK_STATE rule. A
 * stored "effective result" would be a second source of truth about the one
 * fact this table exists to hold.
 */
export function screenOutcome(s) {
  return {
    result: s.result,
    substances: s.substances,
    labResult: s.labResult,
    labSubstances: s.labSubstances,
    effectiveResult: s.labResult ?? s.result,
    // True only when the lab DISAGREES — not merely when a lab result exists.
    contradicted: s.labResult != null && s.labResult !== s.result,
    // They paid, and the lab cleared them. The case-by-case refund surface;
    // the app flags it and never moves money.
    refundDue: s.labResult === SCREEN_RESULT.NEGATIVE && s.feeLedgerEntryId != null,
  }
}

/** The row shape WITHOUT any outcome — what the work queue sends. */
function shapeRow(s) {
  return {
    id: s.id,
    resident: {
      id: s.stay.resident.id,
      fullName: `${s.stay.resident.firstName} ${s.stay.resident.lastName}`,
    },
    stayId: s.stayId,
    reason: s.reason,
    method: s.method,
    collectedAt: s.collectedAt,
    specimenId: s.specimenId,
    witnessedBy: s.witnessedBy,
    recordedBy: s.recordedBy,
    confirmation: s.confirmation,
    residentDecisionAt: s.residentDecisionAt,
    decisionRecordedBy: s.decisionRecordedBy,
    labName: s.labName,
    labReference: s.labReference,
    labSentAt: s.labSentAt,
    labReturnedAt: s.labReturnedAt,
    labRecordedBy: s.labRecordedBy,
    amended: Boolean(s.supersedesId),
    amendmentReason: s.amendmentReason,
    // Deliberately NO result, no substances, no labResult. The queue does not
    // carry outcomes at all — see getScreen().
  }
}

/** The full screen, outcome included. Only ever returned one at a time. */
function shapeFull(s) {
  return { ...shapeRow(s), note: s.note, outcome: screenOutcome(s) }
}

/** The confirmation state a freshly recorded result lands in. */
function initialConfirmation(result) {
  return CONFIRMABLE.includes(result)
    ? CONFIRMATION_STATUS.PENDING_DECISION
    : CONFIRMATION_STATUS.NOT_OFFERED
}

/** Friendly errors in front of the CHECKs — a 500 is not an explanation. */
function validateCollection({ result, substances, specimenId }) {
  const subs = [...new Set(substances ?? [])]
  if (result === SCREEN_RESULT.POSITIVE && subs.length === 0) {
    throw new HttpError(400, 'A positive names what was found — pick at least one substance.')
  }
  if (result !== SCREEN_RESULT.POSITIVE && subs.length > 0) {
    throw new HttpError(400, 'Only a positive carries substances.')
  }
  const needsSpecimen = ![SCREEN_RESULT.NEGATIVE, SCREEN_RESULT.REFUSAL].includes(result)
  if (needsSpecimen && !specimenId?.trim()) {
    throw new HttpError(400, 'A specimen needs its seal number — it is what ties this to a lab report.')
  }
  return subs
}

/**
 * Record a collection.
 *
 * `collectedAt` is client-supplied — a screen is recorded after the fact —
 * but bounded to the last 24 hours by a CHECK, so the back-fill it permits is
 * a shift rather than a week. `createdAt` stays the honest record of when it
 * was typed.
 */
export async function recordScreen(input, actorId) {
  const stay = await prisma.stay.findFirst({
    where: { residentId: input.residentId, status: STAY_STATUS.ACTIVE },
    select: { id: true },
  })
  // The one place this diverges from the ledger's "a discharged stay may still
  // take entries": you cannot collect a specimen from somebody who has left.
  if (!stay) throw new HttpError(409, 'This resident is not currently in the program.')

  const substances = validateCollection(input)
  const screen = await prisma.drugScreen.create({
    data: {
      stayId: stay.id,
      reason: input.reason,
      method: input.method,
      collectedAt: input.collectedAt ? new Date(input.collectedAt) : new Date(),
      witnessedById: input.witnessedById,
      result: input.result,
      substances,
      specimenId: input.specimenId?.trim() || null,
      note: input.note?.trim() || null,
      recordedById: actorId,
      confirmation: initialConfirmation(input.result),
    },
    include: WITH_PEOPLE,
  })
  return shapeFull(screen)
}

/**
 * Record the resident's decision, and — when they elect confirmation — the
 * $50 that goes with it, in ONE transaction. Half of this landing is either a
 * charge with no reason or a lab request nobody billed.
 *
 * ALL-STAFF, and the $50 does not weaken module 11's manager-only rule. That
 * rule is a property of the `/residents/:id/ledger` ROUTE, where a human
 * chooses an amount, a type, a category and a description. Here the tech
 * chooses none of those: the price, the category, the wording and whose ledger
 * it lands on are all determined by the event they are recording.
 */
export function recordDecision(id, { decision, labName, labReference }, actorId) {
  return runInTransaction(async () => {
    const screen = await prisma.drugScreen.findUnique({
      where: { id },
      include: { supersededBy: { select: { id: true } }, stay: { select: { id: true } } },
    })
    if (!screen) throw new HttpError(404, 'Screen not found')
    if (screen.supersededBy) {
      throw new HttpError(409, 'This screen has been amended. Record the decision on the amendment.')
    }
    if (screen.confirmation !== CONFIRMATION_STATUS.PENDING_DECISION) {
      throw new HttpError(
        409,
        screen.confirmation === CONFIRMATION_STATUS.NOT_OFFERED
          ? 'There is nothing to confirm on this screen.'
          : 'That decision has already been recorded.',
      )
    }

    const now = new Date()
    const data = {
      confirmation: decision,
      residentDecisionAt: now,
      decisionRecordedById: actorId,
    }

    if (decision === CONFIRMATION_STATUS.REQUESTED) {
      if (!labName?.trim()) throw new HttpError(400, 'Name the lab the specimen is going to.')
      const fee = await postEntry(
        {
          stayId: screen.stayId,
          type: LEDGER_ENTRY_TYPE.CHARGE,
          category: LEDGER_CATEGORY.LAB_FEE,
          amountCents: LAB_CONFIRMATION_FEE_CENTS,
          // NO result and NO substance in the description. A ledger line is
          // readable by any staff member; the category alone already implies a
          // non-negative, and that is as far as this goes.
          description: 'Lab confirmation fee',
          occurredAt: now,
        },
        actorId,
      )
      data.labName = labName.trim()
      data.labReference = labReference?.trim() || null
      data.labSentAt = now
      data.feeLedgerEntryId = fee.id
    }

    const updated = await prisma.drugScreen.update({
      where: { id },
      data,
      include: WITH_PEOPLE,
    })
    return shapeFull(updated)
  })
}

/**
 * Record what the lab reported.
 *
 * POSTS NOTHING, in either direction. If the lab clears somebody who paid, the
 * refund is case-by-case (facility policy, 2026-08-06): this surfaces it and a
 * manager posts a credit by hand through the manager-gated ledger route, at
 * whatever amount they judge right. Automatic money movement here would be the
 * app making a facility decision.
 */
export async function recordLabResult(id, input, actorId) {
  const screen = await prisma.drugScreen.findUnique({
    where: { id },
    include: { supersededBy: { select: { id: true } } },
  })
  if (!screen) throw new HttpError(404, 'Screen not found')
  if (screen.supersededBy) {
    throw new HttpError(409, 'This screen has been amended. Record the lab result on the amendment.')
  }
  if (screen.confirmation !== CONFIRMATION_STATUS.REQUESTED) {
    throw new HttpError(409, 'No confirmation is outstanding on this screen.')
  }
  if (!LAB_VOCABULARY.includes(input.labResult)) {
    throw new HttpError(400, 'A lab reports negative, positive or dilute — nothing else.')
  }
  const labSubstances = [...new Set(input.labSubstances ?? [])]
  if (input.labResult === SCREEN_RESULT.POSITIVE && labSubstances.length === 0) {
    throw new HttpError(400, 'A positive names what was found — pick at least one substance.')
  }
  if (input.labResult !== SCREEN_RESULT.POSITIVE && labSubstances.length > 0) {
    throw new HttpError(400, 'Only a positive carries substances.')
  }

  const updated = await prisma.drugScreen.update({
    where: { id },
    data: {
      confirmation: CONFIRMATION_STATUS.RETURNED,
      labResult: input.labResult,
      labSubstances,
      labReference: input.labReference?.trim() || screen.labReference,
      labReturnedAt: new Date(),
      labRecordedById: actorId,
    },
    include: WITH_PEOPLE,
  })
  return shapeFull(updated)
}

/**
 * Correct a screen with an amendment — a pure INSERT, per the schema footer.
 *
 * THE CONFIRMATION ARC CARRIES FORWARD VERBATIM, and this is the one place
 * module 7's rule does NOT transfer. There, an amendment starts unverified
 * because the verification was an attestation about the very figures being
 * changed. Here the arc records THIRD-PARTY ACTS: fixing a typo in a note does
 * not un-elect a confirmation the resident paid for, and does not un-report
 * what the lab reported.
 */
export function amendScreen(id, input, actorId) {
  return runInTransaction(async () => {
    const original = await prisma.drugScreen.findUnique({
      where: { id },
      include: { supersededBy: { select: { id: true } } },
    })
    if (!original) throw new HttpError(404, 'Screen not found')
    if (original.supersededBy) {
      throw new HttpError(409, 'This screen has already been amended. Amend the latest version.')
    }

    const result = input.result ?? original.result

    // Checked BEFORE the shape rules, so the refusal explains the real
    // problem: an amendment that makes a decided screen unconfirmable would
    // erase a real decision and orphan a real charge. If the cup was misread,
    // the LAB RESULT is the mechanism for saying so — that is what it is for.
    // Reordered after the suite caught this reporting "only a positive carries
    // substances", which is true and beside the point.
    if (
      !CONFIRMABLE.includes(result) &&
      original.confirmation !== CONFIRMATION_STATUS.NOT_OFFERED &&
      original.confirmation !== CONFIRMATION_STATUS.PENDING_DECISION
    ) {
      throw new HttpError(
        409,
        'This screen already has a recorded decision, so its result cannot be amended to one that could not be confirmed. Record the lab result instead.',
      )
    }

    const substances = validateCollection({
      result,
      // A result changing class takes the substances with it, or the shape
      // rules refuse a correction that is otherwise legitimate.
      substances: input.substances ?? (result === original.result ? original.substances : []),
      specimenId: input.specimenId ?? original.specimenId,
    })

    const screen = await prisma.drugScreen.create({
      data: {
        stayId: original.stayId,
        reason: input.reason ?? original.reason,
        method: input.method ?? original.method,
        // Carried verbatim: an amendment corrects what was observed, never when.
        collectedAt: original.collectedAt,
        witnessedById: input.witnessedById ?? original.witnessedById,
        result,
        substances,
        specimenId:
          input.specimenId !== undefined
            ? input.specimenId?.trim() || null
            : original.specimenId,
        note: input.note !== undefined ? input.note.trim() || null : original.note,
        recordedById: actorId,
        // The arc, forward verbatim — recomputed only when nothing was decided.
        confirmation: CONFIRMABLE.includes(result)
          ? original.confirmation === CONFIRMATION_STATUS.NOT_OFFERED
            ? CONFIRMATION_STATUS.PENDING_DECISION
            : original.confirmation
          : CONFIRMATION_STATUS.NOT_OFFERED,
        residentDecisionAt: original.residentDecisionAt,
        decisionRecordedById: original.decisionRecordedById,
        feeLedgerEntryId: original.feeLedgerEntryId,
        labName: original.labName,
        labReference: original.labReference,
        labSentAt: original.labSentAt,
        labResult: original.labResult,
        labSubstances: original.labSubstances,
        labReturnedAt: original.labReturnedAt,
        labRecordedById: original.labRecordedById,
        supersedesId: original.id,
        amendmentReason: input.amendmentReason,
      },
      include: WITH_PEOPLE,
    })
    return shapeFull(screen)
  })
}

/**
 * One screen in full, outcome included.
 *
 * THIS is the reveal. `GET /screens` deliberately carries no outcomes at all,
 * so revealing a row fetches exactly one screen — which makes the reveal a
 * real authorization and AUDIT boundary rather than a client-side curtain over
 * data already sent. CLAUDE.md: "client-side hiding is presentation, never
 * protection." It is also what keeps the audit log able to answer "who looked
 * at whose result", which is the whole justification for techs seeing the
 * Clinical group at all.
 */
export async function getScreen(id) {
  const screen = await prisma.drugScreen.findUnique({ where: { id }, include: WITH_PEOPLE })
  if (!screen) throw new HttpError(404, 'Screen not found')
  return shapeFull(screen)
}

/** Which of these charges have already had a credit posted against them. */
async function settledRefunds(chargeIds) {
  if (chargeIds.length === 0) return new Set()
  const credits = await prisma.ledgerEntry.findMany({
    where: { correctsId: { in: chargeIds }, type: LEDGER_ENTRY_TYPE.CREDIT },
    select: { correctsId: true },
  })
  return new Set(credits.map((c) => c.correctsId))
}

/**
 * The one read behind /screens: three action bands over recent history.
 *
 * Ordered by what has a clock on it, the /service reasoning — an offer with no
 * recorded answer is the evidence gap this module exists to close, so it leads.
 */
export async function houseScreens() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
  const [awaitingDecision, awaitingLab, returned, recent] = await Promise.all([
    prisma.drugScreen.findMany({
      where: { confirmation: CONFIRMATION_STATUS.PENDING_DECISION, ...CURRENT_ONLY },
      orderBy: { collectedAt: 'asc' },
      include: WITH_PEOPLE,
    }),
    prisma.drugScreen.findMany({
      where: { confirmation: CONFIRMATION_STATUS.REQUESTED, ...CURRENT_ONLY },
      orderBy: { labSentAt: 'asc' },
      include: WITH_PEOPLE,
    }),
    prisma.drugScreen.findMany({
      where: {
        confirmation: CONFIRMATION_STATUS.RETURNED,
        labReturnedAt: { gte: thirtyDaysAgo },
        ...CURRENT_ONLY,
      },
      orderBy: { labReturnedAt: 'desc' },
      include: WITH_PEOPLE,
    }),
    prisma.drugScreen.findMany({
      where: { collectedAt: { gte: thirtyDaysAgo }, ...CURRENT_ONLY },
      orderBy: { collectedAt: 'desc' },
      take: 50,
      include: WITH_PEOPLE,
    }),
  ])

  // Refund review is derived, never flagged: a settled refund is a CREDIT
  // whose correctsId points at the fee. That column already means this, and a
  // stored flag would need somebody to remember to clear it.
  const chargeIds = returned.map((s) => s.feeLedgerEntryId).filter(Boolean)
  const settled = await settledRefunds(chargeIds)
  const toReview = returned.filter(
    (s) => screenOutcome(s).refundDue && !settled.has(s.feeLedgerEntryId),
  ).length

  return {
    feeCents: LAB_CONFIRMATION_FEE_CENTS,
    figures: {
      awaitingDecision: awaitingDecision.length,
      awaitingLab: awaitingLab.length,
      // A count, never a name against a result — the one number a manager
      // needs to know there is refund review waiting.
      toReview,
    },
    bands: {
      awaitingDecision: awaitingDecision.map(shapeRow),
      awaitingLab: awaitingLab.map(shapeRow),
      returned: returned.map((s) => ({
        ...shapeRow(s),
        // Whether a refund is OWED is a money fact, not a clinical one, and a
        // manager cannot review what they cannot see is waiting.
        refundDue: screenOutcome(s).refundDue && !settled.has(s.feeLedgerEntryId),
        residentId: s.stay.resident.id,
      })),
      recent: recent.map(shapeRow),
    },
  }
}

/**
 * How a stay's screens have gone, in COUNTS — never a percentage.
 *
 * The `attendanceSummary()` habit: a resident may have two screens, and "50%"
 * would imply a measurement where "1 of 2" carries its own sample size.
 *
 * A CONTRADICTED screen is its own bucket rather than being filed under
 * either half. Counting it as positive would contradict this module's central
 * rule — the lab is authoritative — and counting it silently as negative would
 * hide that a cup once read positive, which is a fact the facility may need to
 * explain. It is neither, and it says so.
 */
function screenSummary(screens) {
  const s = { total: screens.length, negative: 0, positive: 0, dilute: 0, refusal: 0, notRead: 0, overturned: 0 }
  for (const row of screens) {
    const o = screenOutcome(row)
    if (o.contradicted) {
      s.overturned += 1
      continue
    }
    const effective = o.effectiveResult
    if (effective === SCREEN_RESULT.NEGATIVE) s.negative += 1
    else if (effective === SCREEN_RESULT.POSITIVE) s.positive += 1
    else if (effective === SCREEN_RESULT.DILUTE) s.dilute += 1
    else if (effective === SCREEN_RESULT.REFUSAL) s.refusal += 1
    else s.notRead += 1
  }
  return s
}

/**
 * One resident's screens, for the record section. Active stay only — the
 * Service/Ledger/Schedule/Checks precedent.
 *
 * UNLIKE the queue, this DOES carry outcomes (decided 2026-08-06). A record
 * page is a deliberate navigation to one named person somebody already chose,
 * which is the very argument module 1 makes for techs seeing the Clinical
 * group at all; the queue lists many people at once and keeps its
 * fetch-on-reveal boundary. The audit unit here becomes "opened this
 * resident's screens", which is the right grain for a page about one person.
 */
export async function residentScreens(residentId) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    select: { id: true, intakeAt: true },
  })
  if (!stay) return { hasActiveStay: false, stayId: null, since: null, summary: null, screens: [] }

  const screens = await prisma.drugScreen.findMany({
    where: { stayId: stay.id, ...CURRENT_ONLY },
    orderBy: { collectedAt: 'desc' },
    take: 100,
    include: WITH_PEOPLE,
  })
  return {
    hasActiveStay: true,
    stayId: stay.id,
    since: stay.intakeAt,
    // Null rather than a zero-filled object when nothing is recorded: a
    // 0-of-0 bar reads as a failing grade rather than as an absence of
    // information, so the client hides the band entirely.
    summary: screens.length ? screenSummary(screens) : null,
    screens: screens.map((s) => ({ ...shapeRow(s), note: s.note, outcome: screenOutcome(s) })),
  }
}
