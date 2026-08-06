/**
 * Creating events, and recording what happened at them.
 *
 * Two load-bearing ideas:
 *
 * 1. **The cohort split is storage, not modelling.** An event is created for the
 *    men, the women, or both, with ONE time and ONE roster. `createEvent` fans
 *    that out to one occurrence per cohort with identical timing and routes each
 *    resident to their own cohort's occurrence — so the caller cannot get the
 *    split wrong, and the composite foreign keys still make a woman on a men's
 *    occurrence impossible.
 *
 * 2. **A future session has no row, so a session is addressed by
 *    `(eventId, date)`.** That is a FAN-OUT address: it resolves to every live
 *    occurrence of the event that runs on that date — one for a single-cohort
 *    event, two for a both-cohorts one, and one again on a date past one side's
 *    endsOn. It is not a claim that a session row is event-scoped; sessions keep
 *    their own (occurrenceId, sessionDate) uniqueness.
 */
import { prisma, runInTransaction } from '../../db/client.js'
import { HttpError } from '../../middleware/authorize.js'
import { PRISMA } from '../../lib/http.js'
import { RECURRENCE, STAY_STATUS } from '../../domain/constants.js'
import { facilityWallClockToUtc } from '../../lib/facilityTime.js'
import { LANE_ORDER } from './band.js'
import { addDays, dateKeyToUtc, occursOn, utcToDateKey } from './expand.js'

/**
 * Resolve one combined roster onto the cohorts that will hold it.
 *
 * Every refusal here names a COHORT, never a resident. An error body is a log
 * line and a toast, and a resident's name in one is a 42 CFR Part 2 disclosure.
 */
async function cohortsOfStays(stayIds, allowedCohorts) {
  if (new Set(stayIds).size !== stayIds.length) {
    throw new HttpError(400, 'The same resident appears twice on this roster.')
  }

  const stays = await prisma.stay.findMany({
    where: { id: { in: stayIds }, status: STAY_STATUS.ACTIVE },
    select: { id: true, cohort: true },
  })
  if (stays.length !== stayIds.length) {
    throw new HttpError(409, 'One or more residents are no longer active and cannot be added.')
  }

  const cohortOf = new Map(stays.map((s) => [s.id, s.cohort]))
  // Refused rather than absorbed. Auto-widening the event's cohorts would let a
  // mis-tap in the picker silently schedule the other half of the house — the
  // "combined by accident" failure module 3 exists to prevent, arriving through
  // the front door. Silently dropping the resident is worse still: the roster
  // comes back shorter than what was submitted with nothing saying so.
  if (stayIds.some((id) => !allowedCohorts.includes(cohortOf.get(id)))) {
    throw new HttpError(409, 'One or more residents are not in the cohorts this event is for.')
  }
  return cohortOf
}

/**
 * An event, its per-cohort occurrences and their rosters — all or nothing.
 *
 * The intake case again: without the transaction a failure partway leaves an
 * event with one cohort's occurrence and not the other's, which reads on the
 * board as a men's group the women were never scheduled for.
 */
export async function createEvent(input, actorId) {
  return runInTransaction(async () => {
    // Canonical order, so occurrence creation is deterministic and the
    // `cohorts` array on every read comes back the same way round.
    const cohorts = LANE_ORDER.filter((c) => input.cohorts.includes(c))
    const cohortOf = await cohortsOfStays(input.stayIds ?? [], cohorts)

    const event = await prisma.scheduleEvent.create({
      data: {
        title: input.title,
        description: input.description || null,
        location: input.location || null,
        createdById: actorId,
      },
    })

    // A ONCE runs on exactly one day, so its window closes on the day it opens.
    // The CHECK constraint says the same; setting it here means a caller never
    // has to send endsOn for a one-off.
    const endsOn = input.recurrence === RECURRENCE.ONCE ? input.startsOn : (input.endsOn ?? null)

    for (const cohort of cohorts) {
      const occurrence = await prisma.scheduleOccurrence.create({
        data: {
          eventId: event.id,
          cohort,
          // IDENTICAL across every occurrence of the event. Nothing in the
          // database enforces that — see the merge's refuse-to-merge fallback
          // in band.js, which is the read side of the same invariant.
          startsAtLocal: input.startsAtLocal,
          durationMinutes: input.durationMinutes,
          recurrence: input.recurrence,
          weekdays: input.recurrence === RECURRENCE.ONCE ? [] : input.weekdays,
          startsOn: dateKeyToUtc(input.startsOn),
          endsOn: endsOn ? dateKeyToUtc(endsOn) : null,
        },
      })

      const mine = (input.stayIds ?? []).filter((id) => cohortOf.get(id) === cohort)
      // An empty side is LEGAL and still gets its occurrence. Pruning it would
      // silently convert a both-cohorts event into a single-cohort one.
      if (!mine.length) continue

      await prisma.scheduleAttendee.createMany({
        data: mine.map((stayId) => ({
          occurrenceId: occurrence.id,
          cohort,
          stayId,
          addedById: actorId,
        })),
      })
    }

    return getEvent(event.id)
  })
}

/**
 * The event as one thing: one set of timing fields, one combined roster.
 *
 * `occurrences` is deliberately IDS AND COHORTS ONLY. Timing belongs to the
 * event now, so exposing it per occurrence would reinvite the per-cohort-time
 * idea this module just removed.
 */
export async function getEvent(id) {
  const event = await prisma.scheduleEvent.findUnique({
    where: { id },
    include: {
      // `deletedAt: null` SPELLED OUT on both nested levels, and it has to be.
      // The soft-delete extension rewrites the TOP-LEVEL query only, so a nested
      // include reaches removed rows — which made a resident taken off a roster
      // keep appearing on it, and made adding them back look like it worked when
      // nothing had happened.
      occurrences: {
        where: { deletedAt: null },
        include: {
          attendees: {
            where: { deletedAt: null },
            include: {
              stay: { include: { resident: { select: { id: true, firstName: true, lastName: true } } } },
            },
          },
        },
      },
    },
  })
  if (!event) throw new HttpError(404, 'Event not found')

  const ordered = LANE_ORDER.map((c) => event.occurrences.find((o) => o.cohort === c)).filter(Boolean)
  const [first] = ordered
  if (!first) throw new HttpError(404, 'Event not found')

  // What has been recorded, so an editor can lock the fields it must not offer
  // rather than letting somebody fill a form the server will refuse. The client
  // gate is presentation; updateEvent enforces the same thing server-side.
  const record = await recordedAgainst(ordered.map((o) => o.id))

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    cohorts: ordered.map((o) => o.cohort),
    startsAtLocal: first.startsAtLocal,
    durationMinutes: first.durationMinutes,
    recurrence: first.recurrence,
    weekdays: first.weekdays,
    startsOn: utcToDateKey(first.startsOn),
    endsOn: first.endsOn ? utcToDateKey(first.endsOn) : null,
    // Provenance, when this event continues an earlier one.
    supersedesId: event.supersedesId,
    moveReason: event.moveReason,
    /** Recorded history. `frozen` means the shape fields are no longer editable. */
    recorded: {
      frozen: record.frozen,
      marked: record.marked,
      cancelled: record.cancelled,
      lastRecordedDate: record.lastRecordedDate,
    },
    occurrences: ordered.map((o) => ({ id: o.id, cohort: o.cohort })),
    attendees: ordered.flatMap((o) =>
      o.attendees.map((a) => ({
        stayId: a.stayId,
        residentId: a.stay.resident.id,
        fullName: `${a.stay.resident.firstName} ${a.stay.resident.lastName}`,
        cohort: o.cohort,
      })),
    ),
  }
}

/**
 * What has been RECORDED against an event, and therefore what may no longer move.
 *
 * The predicate every guard below shares, and the reason it is one function: the
 * rules for editing, ending and deleting are the same rule wearing three hats,
 * and three copies of it is how they come to disagree about what counts as
 * history.
 *
 * Attendance AND cancellations both count. A cancelled session is read by an
 * auditor as "the meeting did not happen", which is as much a claim about the
 * past as a roll is. A bare `startsAtLocalOverride` is NOT — that is a decision
 * about one date, and losing it costs an override rather than evidence.
 *
 * @returns {{frozen: boolean, marked: number, cancelled: number, lastRecordedDate: string|null}}
 */
async function recordedAgainst(occurrenceIds) {
  if (!occurrenceIds.length) {
    return { frozen: false, marked: 0, cancelled: 0, lastRecordedDate: null }
  }

  const [marked, cancelled, latest] = await Promise.all([
    prisma.scheduleAttendance.count({
      where: { session: { occurrenceId: { in: occurrenceIds } } },
    }),
    prisma.scheduleSession.count({
      where: { occurrenceId: { in: occurrenceIds }, cancelledAt: { not: null } },
    }),
    // The last date carrying a record, which is the floor an endsOn may not go
    // under. Ordered rather than aggregated because `sessionDate` is @db.Date and
    // comes back as a Date needing utcToDateKey either way.
    prisma.scheduleSession.findFirst({
      where: {
        occurrenceId: { in: occurrenceIds },
        OR: [{ attendanceTakenAt: { not: null } }, { cancelledAt: { not: null } }],
      },
      orderBy: { sessionDate: 'desc' },
      select: { sessionDate: true },
    }),
  ])

  return {
    frozen: marked > 0 || cancelled > 0,
    marked,
    cancelled,
    lastRecordedDate: latest ? utcToDateKey(latest.sessionDate) : null,
  }
}

/** How the refusals below describe what is already on the record. */
function recordedPhrase({ marked, cancelled }) {
  const bits = []
  if (marked > 0) bits.push(`${marked} attendance ${marked === 1 ? 'mark' : 'marks'}`)
  if (cancelled > 0) bits.push(`${cancelled} cancelled ${cancelled === 1 ? 'session' : 'sessions'}`)
  return bits.join(' and ')
}

/** The fields that decide WHICH DATES EXIST and WHEN. Frozen once anything is recorded. */
const SHAPE_FIELDS = Object.freeze([
  'startsAtLocal',
  'durationMinutes',
  'recurrence',
  'weekdays',
  'startsOn',
  'cohorts',
])

/**
 * Editing an event.
 *
 * Three tiers, and which tier a field is in is decided by what changing it does
 * to records that already exist — not by how important the field looks:
 *
 * - **Identity** (`title`, `description`, `location`) is always free. Renaming a
 *   group does not move a session or invalidate a mark.
 * - **The roster** is always free, even on an event with months of history, and
 *   that is the design working rather than a concession: the roster hangs off the
 *   occurrence and marks hang off the dated session, so taking somebody off next
 *   week cannot touch what was recorded last week. This is the commonest real
 *   edit — somebody joins a group mid-series.
 * - **Shape** (see SHAPE_FIELDS) is frozen the moment anything is recorded,
 *   because `expand()` consults `occursOn` BEFORE it looks at session rows. Move
 *   a Tuesday group to Thursdays and last week's taken roll stops being emitted
 *   by every read path while its rows sit orphaned. `moveSeries` is the operation
 *   for that, and it preserves the past by leaving its rule alone.
 *
 * `endsOn` is its own case: always editable, but never earlier than the last date
 * carrying a record. Shortening the window past a taken session orphans it by the
 * exact same `occursOn` gate, which makes this the easiest of these rules to ship
 * a bug in — ending a series is the SANCTIONED edit.
 */
export async function updateEvent(id, data, actorId) {
  return runInTransaction(async () => {
    const event = await prisma.scheduleEvent.findUnique({
      where: { id },
      include: {
        // Nested `deletedAt: null` is mandatory — the soft-delete extension only
        // rewrites the top-level query. Without it a previously-removed attendee
        // sits in `have` below, so re-adding them is a silent no-op.
        occurrences: {
          where: { deletedAt: null },
          include: {
            attendees: { where: { deletedAt: null }, select: { id: true, stayId: true, cohort: true } },
          },
        },
      },
    })
    if (!event) throw new HttpError(404, 'Event not found')

    const ordered = LANE_ORDER.map((c) => event.occurrences.find((o) => o.cohort === c)).filter(Boolean)
    if (!ordered.length) throw new HttpError(404, 'Event not found')

    const occurrenceIds = ordered.map((o) => o.id)
    const record = await recordedAgainst(occurrenceIds)

    const wants = (k) => Object.hasOwn(data, k) && data[k] !== undefined
    const changedShape = SHAPE_FIELDS.filter((k) => {
      if (!wants(k)) return false
      if (k === 'cohorts') {
        const next = LANE_ORDER.filter((c) => data.cohorts.includes(c))
        return next.join(',') !== ordered.map((o) => o.cohort).join(',')
      }
      if (k === 'startsOn') return data.startsOn !== utcToDateKey(ordered[0].startsOn)
      if (k === 'weekdays') return data.weekdays.join(',') !== (ordered[0].weekdays ?? []).join(',')
      return data[k] !== ordered[0][k]
    })

    if (changedShape.length && record.frozen) {
      throw new HttpError(
        409,
        `This event has ${recordedPhrase(record)} against it, so when it runs is part of the record. ` +
          'Move the series instead — that ends this one and starts a new one, leaving what was ' +
          'recorded exactly where it is.',
      )
    }

    // ── endsOn ───────────────────────────────────────────────────────────────
    let endsOn
    if (wants('endsOn') || Object.hasOwn(data, 'endsOn')) {
      const next = data.endsOn ?? null
      if (next && record.lastRecordedDate && next < record.lastRecordedDate) {
        throw new HttpError(
          409,
          `This event has a record on ${record.lastRecordedDate}. Ending it before then would ` +
            'take that session off every screen while its rows stayed in the database. Choose ' +
            `${record.lastRecordedDate} or later.`,
        )
      }
      endsOn = next
    }

    // ── Identity ─────────────────────────────────────────────────────────────
    const eventData = {}
    if (wants('title')) eventData.title = data.title
    if (Object.hasOwn(data, 'description')) eventData.description = data.description || null
    if (Object.hasOwn(data, 'location')) eventData.location = data.location || null
    if (Object.keys(eventData).length) {
      await prisma.scheduleEvent.update({ where: { id }, data: eventData })
    }

    // ── Shape, fanned out ────────────────────────────────────────────────────
    // Every occurrence or none. Writing one side and not the other makes the two
    // disagree, and band.js catches that by REFUSING to merge — one shared card
    // splitting into two lane cards is the visible symptom and the assertion.
    const occData = {}
    if (wants('startsAtLocal')) occData.startsAtLocal = data.startsAtLocal
    if (wants('durationMinutes')) occData.durationMinutes = data.durationMinutes
    if (wants('recurrence')) occData.recurrence = data.recurrence
    if (wants('startsOn')) occData.startsOn = dateKeyToUtc(data.startsOn)

    const recurrence = data.recurrence ?? ordered[0].recurrence
    if (wants('weekdays') || wants('recurrence')) {
      occData.weekdays = recurrence === RECURRENCE.ONCE ? [] : (data.weekdays ?? ordered[0].weekdays)
    }
    // A one-off closes its window on the day it opens — the same rule createEvent
    // applies, and the occurrence_rule_coherent CHECK enforces it.
    if (recurrence === RECURRENCE.ONCE) {
      const startsOn = data.startsOn ?? utcToDateKey(ordered[0].startsOn)
      occData.endsOn = dateKeyToUtc(startsOn)
    } else if (endsOn !== undefined) {
      occData.endsOn = endsOn ? dateKeyToUtc(endsOn) : null
    }

    if (Object.keys(occData).length) {
      await prisma.scheduleOccurrence.updateMany({ where: { eventId: id }, data: occData })
    }

    // ── Cohorts ──────────────────────────────────────────────────────────────
    // Only reachable on an unfrozen event, so removing an occurrence is clean.
    // Soft-deleted, and the one_live_occurrence_per_event_cohort partial index is
    // what lets a cohort be added back later.
    const cohorts = wants('cohorts')
      ? LANE_ORDER.filter((c) => data.cohorts.includes(c))
      : ordered.map((o) => o.cohort)

    if (wants('cohorts')) {
      for (const o of ordered) {
        if (cohorts.includes(o.cohort)) continue
        await prisma.scheduleAttendee.deleteMany({ where: { occurrenceId: o.id } })
        await prisma.scheduleOccurrence.delete({ where: { id: o.id } })
      }
      for (const cohort of cohorts) {
        if (ordered.some((o) => o.cohort === cohort)) continue
        await prisma.scheduleOccurrence.create({
          data: {
            eventId: id,
            cohort,
            startsAtLocal: occData.startsAtLocal ?? ordered[0].startsAtLocal,
            durationMinutes: occData.durationMinutes ?? ordered[0].durationMinutes,
            recurrence,
            weekdays: occData.weekdays ?? ordered[0].weekdays,
            startsOn: occData.startsOn ?? ordered[0].startsOn,
            endsOn: occData.endsOn !== undefined ? occData.endsOn : ordered[0].endsOn,
          },
        })
      }
    }

    // ── Roster ───────────────────────────────────────────────────────────────
    if (wants('stayIds')) {
      // Re-read: a cohort change above may have created or removed occurrences.
      // Nested `deletedAt: null` again — without it a previously-removed attendee
      // lands in `have` and adding them back is a silent no-op that returns 200.
      const live = await prisma.scheduleOccurrence.findMany({
        where: { eventId: id },
        include: { attendees: { where: { deletedAt: null }, select: { id: true, stayId: true } } },
      })
      const cohortOf = await cohortsOfStays(data.stayIds, cohorts)

      for (const occurrence of live) {
        const want = new Set(data.stayIds.filter((s) => cohortOf.get(s) === occurrence.cohort))
        const have = new Map(occurrence.attendees.map((a) => [a.stayId, a.id]))

        const remove = [...have].filter(([stayId]) => !want.has(stayId)).map(([, rowId]) => rowId)
        if (remove.length) {
          // Soft — and their marks are untouched regardless, because a mark hangs
          // off the session, not off this row. sessionRoll surfaces those as
          // offRoster so a taken roll never loses somebody retroactively.
          await prisma.scheduleAttendee.deleteMany({ where: { id: { in: remove } } })
        }

        const add = [...want].filter((stayId) => !have.has(stayId))
        if (add.length) {
          await prisma.scheduleAttendee.createMany({
            data: add.map((stayId) => ({
              occurrenceId: occurrence.id,
              cohort: occurrence.cohort,
              stayId,
              addedById: actorId,
            })),
          })
        }
      }
    }

    return getEvent(id)
  })
}

/**
 * Moving a series: end this one, start its successor.
 *
 * The answer to "the Tuesday group is Thursdays from now on", and the reason
 * editing a recurrence rule in place is refused. Rewriting the rule would make
 * every past Tuesday stop being emitted by `expand`; ending the old series
 * instead leaves every past date covered by the rule that produced it, so the
 * rolls stay exactly where they are and stay readable.
 *
 * It is also what happened operationally. A group that met on Tuesdays until
 * August and Thursdays after is two series, and the facility would describe it
 * that way.
 */
export async function moveSeries(id, { from, reason, ...shape }, actorId) {
  return runInTransaction(async () => {
    const event = await prisma.scheduleEvent.findUnique({
      where: { id },
      include: {
        // Nested `deletedAt: null`, as above — a removed attendee must not be
        // carried into the successor.
        occurrences: {
          where: { deletedAt: null },
          include: { attendees: { where: { deletedAt: null }, select: { stayId: true } } },
        },
      },
    })
    if (!event) throw new HttpError(404, 'Event not found')

    const ordered = LANE_ORDER.map((c) => event.occurrences.find((o) => o.cohort === c)).filter(Boolean)
    if (!ordered.length) throw new HttpError(404, 'Event not found')

    const record = await recordedAgainst(ordered.map((o) => o.id))

    // Nothing to preserve means this is an ordinary edit, and splitting would
    // leave a stub series with no sessions in it cluttering the board forever.
    if (!record.frozen) {
      throw new HttpError(
        409,
        'Nothing has been recorded against this event yet, so there is no history to preserve. ' +
          'Edit it directly instead.',
      )
    }

    if (record.lastRecordedDate && from <= record.lastRecordedDate) {
      throw new HttpError(
        409,
        `This event has a record on ${record.lastRecordedDate}. A move has to start after that, ` +
          'or the new series would cover a date the old one already accounted for.',
      )
    }

    const startsOn = utcToDateKey(ordered[0].startsOn)
    if (from <= startsOn) {
      throw new HttpError(
        409,
        'A move has to start after the series began. To change an event from the beginning, ' +
          'end it and create a new one.',
      )
    }

    // One live successor per event, so a provenance chain cannot fork. The partial
    // unique index enforces it; this is its readable face, because a raw unique
    // violation surfaces as a 500 rather than as an explanation.
    const successorExists = await prisma.scheduleEvent.findFirst({
      where: { supersedesId: id },
      select: { id: true },
    })
    if (successorExists) {
      throw new HttpError(
        409,
        'This event has already been moved. Move the series that replaced it instead — ' +
          'a chain of changes has to stay a chain.',
      )
    }

    // READ BEFORE THE OVERWRITE. The successor inherits the window the old series
    // was heading for, and the next line destroys it.
    //
    // Only inherited when it is still ahead of the new start: after any move the
    // old endsOn is `from - 1` by construction, so carrying it verbatim would give
    // the successor an endsOn before its own startsOn and trip
    // occurrence_window_ordered — which is exactly what a second move used to do.
    // An end date already behind us was never about the new series, so the honest
    // reading is open-ended.
    const priorEndsOn = ordered[0].endsOn ? utcToDateKey(ordered[0].endsOn) : null
    const inheritedEndsOn = priorEndsOn && priorEndsOn >= from ? priorEndsOn : null

    // The old series closes the day before the new one opens: no gap, no overlap,
    // and no date belonging to two rules.
    const lastDay = addDays(from, -1)
    await prisma.scheduleOccurrence.updateMany({
      where: { eventId: id },
      data: { endsOn: dateKeyToUtc(lastDay) },
    })

    // The roster carries over. Retyping it is the friction that would send this
    // back to paper, and it is the same people until somebody says otherwise.
    //
    // FILTERED TO ACTIVE STAYS. A discharged resident is still on the old
    // occurrence's roster — deliberately, because that is how their past marks
    // keep their context and how a discharge costs no write to the schedule — but
    // they are not on next month's group. Without this filter `cohortsOfStays`
    // refuses the whole move the first time somebody on the roster has left, which
    // is the common case for a series old enough to be worth moving.
    const carried = [...new Set(ordered.flatMap((o) => o.attendees.map((a) => a.stayId)))]
    const active = await prisma.stay.findMany({
      where: { id: { in: carried }, status: STAY_STATUS.ACTIVE },
      select: { id: true },
    })
    const stayIds = active.map((s) => s.id)

    const successor = await createEvent(
      {
        title: shape.title ?? event.title,
        description: shape.description ?? event.description,
        location: shape.location ?? event.location,
        cohorts: shape.cohorts ?? ordered.map((o) => o.cohort),
        startsAtLocal: shape.startsAtLocal ?? ordered[0].startsAtLocal,
        durationMinutes: shape.durationMinutes ?? ordered[0].durationMinutes,
        recurrence: shape.recurrence ?? ordered[0].recurrence,
        weekdays: shape.weekdays ?? ordered[0].weekdays,
        startsOn: from,
        endsOn: shape.endsOn ?? inheritedEndsOn,
        stayIds,
      },
      actorId,
    )

    await prisma.scheduleEvent.update({
      where: { id: successor.id },
      data: { supersedesId: id, moveReason: reason?.trim() || null },
    })

    return { previous: await getEvent(id), event: await getEvent(successor.id) }
  })
}

/**
 * Deleting an event, which is only ever the "created it wrong" case.
 *
 * Once anything has been recorded against it the event is history: soft-deleting
 * it would make the soft-delete extension filter it out of every resident
 * record, silently erasing attendance a licensing audit may need. Ending the
 * series is the operation for a group that has stopped running — the past
 * sessions and their marks stay exactly where they are.
 *
 * Same shape as the sign-outs rule: fixable in error, but only while open.
 *
 * The guard was attendance-only and is now the shared `recordedAgainst`
 * predicate. A cancelled session with no marks used to let the event delete out
 * from under its `schedule_sessions` rows, which can be neither soft-deleted
 * (the model is deliberately outside SOFT_DELETE_MODELS) nor hard-deleted
 * (REVOKE DELETE) — so those rows became permanently unreachable orphans. It
 * also disagreed with the edit rule about what counts as history, which is
 * exactly the drift one predicate exists to prevent.
 */
export async function deleteEvent(id) {
  return runInTransaction(async () => {
    const event = await prisma.scheduleEvent.findUnique({
      where: { id },
      include: { occurrences: { select: { id: true } } },
    })
    if (!event) throw new HttpError(404, 'Event not found')

    const occurrenceIds = event.occurrences.map((o) => o.id)
    const record = await recordedAgainst(occurrenceIds)

    if (record.frozen) {
      throw new HttpError(
        409,
        `This event has ${recordedPhrase(record)} against it, so it is history. ` +
          'End the series instead.',
      )
    }

    await prisma.scheduleAttendee.deleteMany({ where: { occurrenceId: { in: occurrenceIds } } })
    await prisma.scheduleOccurrence.deleteMany({ where: { eventId: id } })
    await prisma.scheduleEvent.delete({ where: { id } })
  })
}

/**
 * Every live occurrence of an event that actually runs on a date.
 *
 * One row for a single-cohort event, two for a both-cohorts one, and one again
 * on a date past one side's endsOn. Refusing an uncovered date here is what
 * stops a caller conjuring a phantom Sunday session for a Tuesday group by
 * posting a date of their choosing — `occursOn` is the same predicate the
 * expander uses, so a session can never exist on a date the board would not
 * have drawn.
 */
async function runningOccurrences(eventId, dateKey) {
  const occurrences = await prisma.scheduleOccurrence.findMany({
    where: { eventId },
    include: { event: { select: { id: true, title: true, location: true } } },
  })
  if (!occurrences.length) throw new HttpError(404, 'Scheduled event not found')

  const running = LANE_ORDER.map((c) => occurrences.find((o) => o.cohort === c))
    .filter(Boolean)
    .filter((o) => occursOn(o, dateKey))
  if (!running.length) throw new HttpError(409, 'This event does not run on that date.')
  return running
}

/**
 * The row for one dated session, created on first need.
 *
 * Takes the occurrence rather than an id — the caller already has it — and
 * re-checks `occursOn` as belt and braces.
 */
export async function materializeSession(occurrence, dateKey) {
  if (!occursOn(occurrence, dateKey)) {
    throw new HttpError(409, 'This event does not run on that date.')
  }

  const where = {
    occurrenceId_sessionDate: { occurrenceId: occurrence.id, sessionDate: dateKeyToUtc(dateKey) },
  }
  const existing = await prisma.scheduleSession.findUnique({ where })
  if (existing) return existing

  try {
    return await prisma.scheduleSession.create({
      data: {
        occurrenceId: occurrence.id,
        cohort: occurrence.cohort,
        sessionDate: dateKeyToUtc(dateKey),
      },
    })
  } catch (err) {
    // Two staff opening the same roll at once. The unique index is the
    // race-proof backstop under the read above; re-read rather than fail.
    if (err.code === PRISMA.UNIQUE_VIOLATION) {
      return prisma.scheduleSession.findUnique({ where })
    }
    throw err
  }
}

/**
 * Taking the roll: every mark for one session of one event, in one request.
 *
 * One request rather than one per resident because this is done standing in a
 * hallway on a phone, and twelve round trips is how it ends up on paper. And
 * ONE roll for a both-cohorts event, because it is one meeting in one room —
 * the marks still land on each cohort's own session underneath.
 *
 * Re-marking updates in place. A mis-tap is corrected by changing the status,
 * not by filing an amendment — the audit extension already records who changed
 * what and when, and making a tech file paperwork to fix a fat finger is the
 * friction this module exists to remove.
 */
export async function takeAttendance({ eventId, date, marks }, actorId) {
  return runInTransaction(async () => {
    const running = await runningOccurrences(eventId, date)

    const stayIds = marks.map((m) => m.stayId)
    if (new Set(stayIds).size !== stayIds.length) {
      throw new HttpError(400, 'The same resident appears twice in this roll.')
    }

    const cohorts = running.map((o) => o.cohort)
    const stays = await prisma.stay.findMany({
      where: { id: { in: stayIds } },
      select: { id: true, cohort: true },
    })
    const cohortOf = new Map(stays.map((s) => [s.id, s.cohort]))
    // Cohort is enforced by the composite foreign key regardless; this turns
    // what would be a 500 into a sentence somebody can act on.
    if (stayIds.some((id) => !cohorts.includes(cohortOf.get(id)))) {
      throw new HttpError(409, 'A resident on this roll is not in this event’s cohort.')
    }

    // EVERY running occurrence gets a session, not only the ones marks route to.
    // A both-cohorts event with an empty roster on one side therefore ends up
    // with a stamped session carrying zero marks — which is not a violation of
    // "a row exists only because something was recorded": the stamp IS the
    // record. It says the roll was taken and nobody was on that side, which is
    // true, and it is what stops that side sitting in the queue forever.
    const sessionByCohort = new Map()
    for (const occurrence of running) {
      sessionByCohort.set(occurrence.cohort, await materializeSession(occurrence, date))
    }

    if ([...sessionByCohort.values()].every((s) => s.cancelledAt)) {
      throw new HttpError(409, 'This session was cancelled, so there is no roll to take.')
    }

    for (const mark of marks) {
      const session = sessionByCohort.get(cohortOf.get(mark.stayId))
      await prisma.scheduleAttendance.upsert({
        where: { sessionId_stayId: { sessionId: session.id, stayId: mark.stayId } },
        create: {
          sessionId: session.id,
          cohort: session.cohort,
          stayId: mark.stayId,
          status: mark.status,
          note: mark.note || null,
          recordedById: actorId,
        },
        update: { status: mark.status, note: mark.note || null, recordedById: actorId },
      })
    }

    // Stamped on EVERY session involved, in this one transaction. That is what
    // makes the roll one fact about the event, satisfies the merge's unanimity
    // rule in a single action, and clears the queue item in one tap.
    const takenAt = new Date()
    await prisma.scheduleSession.updateMany({
      where: { id: { in: [...sessionByCohort.values()].map((s) => s.id) } },
      data: { attendanceTakenAt: takenAt, attendanceTakenById: actorId },
    })

    return sessionRoll(eventId, date)
  })
}

/**
 * Move ONE date's session to a different wall-clock time.
 *
 * One date, never the series. The gesture that drives this is a drag of a
 * single tile, and a tile is one date — silently rewriting every future Tuesday
 * because somebody nudged next week is the direct-manipulation betrayal, and
 * there is no undo stack. Changing the series is `startsAtLocal` on the
 * occurrence, which is editing the event: a form, not a gesture, and deferred.
 *
 * `startsAtLocal: null` clears the override and puts the date back on the rule,
 * because a mis-drag needs a way back and snap granularity may not permit
 * dragging to the exact original minute.
 */
export async function rescheduleSession({ eventId, date, startsAtLocal }, actorId) {
  return runInTransaction(async () => {
    const running = await runningOccurrences(eventId, date)
    const [first] = running

    // A meeting that has already happened — or already not happened — is a
    // record, and its start time is part of what the record says.
    const endsAt = new Date(
      facilityWallClockToUtc(date, first.startsAtLocal).getTime() +
        first.durationMinutes * 60_000,
    )
    if (endsAt < new Date()) {
      throw new HttpError(409, 'That session is in the past. Its time is part of the record.')
    }

    const sessions = []
    for (const occurrence of running) {
      sessions.push(await materializeSession(occurrence, date))
    }

    if (sessions.every((s) => s.cancelledAt)) {
      throw new HttpError(409, 'This session was cancelled, so there is no time to move.')
    }
    if (sessions.some((s) => s.attendanceTakenAt)) {
      throw new HttpError(
        409,
        'The roll has been taken for this session, so its time is part of the record.',
      )
    }

    // EVERY running occurrence, including a side that happens to be cancelled.
    // Writing one and not the other is what makes a shared card lie about when
    // the meeting starts — and the read layer catches it by REFUSING to merge,
    // splitting one card into two. That split is the visible symptom, and it is
    // what the verify assertion looks for.
    await prisma.scheduleSession.updateMany({
      where: { id: { in: sessions.map((s) => s.id) } },
      data: { startsAtLocalOverride: startsAtLocal },
    })

    // Clearing leaves a session row with nothing recorded on it. Leave it:
    // `expand` treats an all-null row exactly like no row, and this table is
    // deliberately outside SOFT_DELETE_MODELS — cancel is the operation and
    // delete is not one.
    return {
      eventId,
      date,
      startsAtLocal: startsAtLocal ?? first.startsAtLocal,
      rescheduled: Boolean(startsAtLocal),
    }
  })
}

/**
 * The roll for one session: the people, and their marks if any exist.
 *
 * THE RULE: before attendance is taken, the list is the live roster; once
 * taken, it is the marks. Someone added to the group last week does not appear
 * on a roll that was completed the week before, and a resident discharged since
 * still shows on the roll they were marked on.
 *
 * For a both-cohorts event this is ONE list spanning both — one meeting, one
 * sheet. Each person carries their cohort so a mixed roster can be badged.
 */
export async function sessionRoll(eventId, date) {
  const running = await runningOccurrences(eventId, date)
  const occurrenceIds = running.map((o) => o.id)
  const [first] = running

  const sessions = await prisma.scheduleSession.findMany({
    where: { occurrenceId: { in: occurrenceIds }, sessionDate: dateKeyToUtc(date) },
    include: {
      attendanceTakenBy: { select: { id: true, fullName: true } },
      attendance: {
        include: {
          stay: { include: { resident: { select: { id: true, firstName: true, lastName: true } } } },
        },
      },
    },
  })

  const roster = await prisma.scheduleAttendee.findMany({
    where: { occurrenceId: { in: occurrenceIds }, stay: { status: STAY_STATUS.ACTIVE } },
    include: {
      stay: {
        include: {
          resident: { select: { id: true, firstName: true, lastName: true } },
          program: { select: { name: true } },
          bedAssignments: {
            where: { endedAt: null },
            include: { bed: { include: { apartment: { select: { name: true } } } } },
          },
        },
      },
    },
  })

  // Keyed by stayId with no risk of collision: a stay can only be marked on its
  // own cohort's session, so the two sides are disjoint by construction.
  const allMarks = sessions.flatMap((s) => s.attendance)
  const marks = new Map(allMarks.map((a) => [a.stayId, a]))

  const fromRoster = roster.map((a) => ({
    stayId: a.stayId,
    residentId: a.stay.resident.id,
    fullName: `${a.stay.resident.firstName} ${a.stay.resident.lastName}`,
    cohort: a.cohort,
    programName: a.stay.program?.name ?? null,
    bedLabel: a.stay.bedAssignments[0]
      ? `${a.stay.bedAssignments[0].bed.apartment.name} · ${a.stay.bedAssignments[0].bed.label}`
      : null,
    status: marks.get(a.stayId)?.status ?? null,
    note: marks.get(a.stayId)?.note ?? null,
  }))

  // Anyone marked who is no longer on the live roster — discharged since, or
  // taken off the group. Their mark is evidence and does not disappear with
  // their roster row, which is exactly why the mark names the stay.
  const onRoster = new Set(fromRoster.map((r) => r.stayId))
  const alsoMarked = allMarks
    .filter((a) => !onRoster.has(a.stayId))
    .map((a) => ({
      stayId: a.stayId,
      residentId: a.stay.resident.id,
      fullName: `${a.stay.resident.firstName} ${a.stay.resident.lastName}`,
      cohort: a.cohort,
      programName: null,
      bedLabel: null,
      status: a.status,
      note: a.note,
      offRoster: true,
    }))

  // Unanimity, matching the board's merge: a roll is taken only when every
  // running occurrence has been stamped, and cancelled only when all are.
  const allTaken = sessions.length === running.length && sessions.every((s) => s.attendanceTakenAt)
  const latest = allTaken
    ? sessions.reduce((a, b) => (a.attendanceTakenAt > b.attendanceTakenAt ? a : b))
    : null
  const allCancelled = sessions.length === running.length && sessions.every((s) => s.cancelledAt)

  return {
    eventId,
    date,
    cohorts: running.map((o) => o.cohort),
    title: first.event.title,
    location: first.event.location,
    startsAtLocal: sessions.find((s) => s.startsAtLocalOverride)?.startsAtLocalOverride
      ?? first.startsAtLocal,
    durationMinutes: first.durationMinutes,
    cancelledAt: allCancelled ? sessions[0].cancelledAt : null,
    cancelReason: sessions.find((s) => s.cancelReason)?.cancelReason ?? null,
    attendanceTakenAt: latest?.attendanceTakenAt ?? null,
    attendanceTakenBy: latest?.attendanceTakenBy ?? null,
    people: [...fromRoster, ...alsoMarked].sort((a, b) => a.fullName.localeCompare(b.fullName)),
  }
}
