import { prisma, runInTransaction } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { MED_DOSE_STATE, MED_LOG_STATUS, MED_PASS_GRACE_MS, STAY_STATUS } from '../domain/constants.js'
import { facilityToday, facilityWallClockToUtc, formatFacilityTime } from '../lib/facilityTime.js'
// Pure date-key arithmetic, imported rather than re-implemented. expand.js calls
// itself "the single source of truth" for this and it is right: a @db.Date
// round-trips as UTC midnight, and a second helper reading one as a local date
// is precisely how two screens come to disagree about which day it is.
import { addDays, dateKeyToUtc, utcToDateKey } from './schedule/expand.js'

/**
 * Med pass: the scheduled window in which staff observe residents taking their
 * own medication.
 *
 * The facility's model (confirmed 2026-08-07, closing open question 3) is
 * STAFF-STORED, RESIDENT SELF-ADMINISTERED. The house holds the meds, staff
 * hand a dose over and watch it taken. Staff never administer, so this is not a
 * clinical MAR. The house stores NO controlled substances, so there is no
 * count, no on-hand figure and no reconciliation anywhere in this module — that
 * is the facility's answer, not a deferral.
 *
 * NOTHING IS MATERIALIZED AND THERE IS NO CRON. A dose exists because a
 * medication carries a wall-clock time and a date has come round; a `med_logs`
 * row exists only because somebody recorded an observation. DUE, UPCOMING and
 * MISSED are all derived on read from the clock — the PRESENCE / CHECK_STATE /
 * SESSION_STATE pattern, and the same reason: a stored state needs a job to
 * flip it and lies the minute the job lags.
 *
 * Times are facility WALL-CLOCK strings converted per date, never instants, so
 * an 8pm dose is 8pm on both sides of a DST boundary. That is
 * ScheduleOccurrence.startsAtLocal's rule and it is load-bearing here for the
 * same reason.
 */

/** The current view: logs no amendment has superseded. */
const CURRENT_ONLY = { supersededBy: { is: null } }

const NAME = { select: { id: true, firstName: true, lastName: true } }
const WHO = { select: { id: true, fullName: true } }
const fullName = (r) => `${r.firstName} ${r.lastName}`

/**
 * Doses scheduled before this instant with nothing recorded against them are
 * MISSED rather than DUE.
 *
 * THE one knob. The board, the bell and the resident record all derive through
 * it, so none of the three can disagree about what is late. See
 * MED_PASS_GRACE_MS for why two hours rather than the fifteen minutes its
 * siblings use.
 */
export function medMissedCutoff(now = new Date()) {
  return new Date(now.getTime() - MED_PASS_GRACE_MS)
}

/**
 * One dose's standing. A recorded log always wins — it is an observation, and
 * no clock overrules it.
 */
export function doseStateOf(scheduledFor, log, now) {
  if (log) return log.status
  if (scheduledFor > now) return MED_DOSE_STATE.UPCOMING
  if (scheduledFor >= medMissedCutoff(now)) return MED_DOSE_STATE.DUE
  return MED_DOSE_STATE.MISSED
}

/** Medications standing on a given facility date. */
function activeOnDate(dateKey) {
  const day = dateKeyToUtc(dateKey)
  return {
    deletedAt: null,
    startsOn: { lte: day },
    OR: [{ endsOn: null }, { endsOn: { gte: day } }],
  }
}

/** The instants bounding one facility calendar day. */
function facilityDayBounds(dateKey) {
  return {
    gte: facilityWallClockToUtc(dateKey, '00:00'),
    lt: facilityWallClockToUtc(addDays(dateKey, 1), '00:00'),
  }
}

const doseKey = (medicationId, scheduledFor) =>
  `${medicationId}|${scheduledFor.toISOString()}`

/**
 * Expand medications into the day's doses. PURE — no database, no clock beyond
 * `now`. A PRN medication produces none: it carries no times, so there is no
 * slot to answer and it can never read DUE.
 */
function expandDoses(medications, dateKey, logsByKey, now) {
  const out = []
  for (const med of medications) {
    if (med.isPrn) continue
    for (const time of med.times) {
      const scheduledFor = facilityWallClockToUtc(dateKey, time)
      const log = logsByKey.get(doseKey(med.id, scheduledFor)) ?? null
      out.push({
        medicationId: med.id,
        stayId: med.stayId,
        time,
        scheduledFor,
        state: doseStateOf(scheduledFor, log, now),
        log,
        medication: med,
      })
    }
  }
  return out.sort((a, b) => a.scheduledFor - b.scheduledFor)
}

/** Loads the day's medications and the live logs answering them. */
async function dayContext(dateKey, { stayId = null } = {}) {
  const medications = await prisma.medication.findMany({
    where: {
      ...activeOnDate(dateKey),
      ...(stayId ? { stayId } : {}),
      stay: { status: STAY_STATUS.ACTIVE },
    },
    include: {
      stay: {
        select: {
          id: true,
          resident: NAME,
          bedAssignments: {
            where: { endedAt: null },
            select: { bed: { select: { label: true, apartment: { select: { name: true } } } } },
          },
        },
      },
    },
    orderBy: [{ name: 'asc' }],
  })

  const logs = medications.length
    ? await prisma.medLog.findMany({
        where: {
          medicationId: { in: medications.map((m) => m.id) },
          scheduledFor: facilityDayBounds(dateKey),
          ...CURRENT_ONLY,
        },
        include: { observedBy: WHO, recordedBy: WHO },
      })
    : []

  const logsByKey = new Map(logs.map((l) => [doseKey(l.medicationId, l.scheduledFor), l]))
  return { medications, logsByKey }
}

const isMarked = (s) =>
  s === MED_LOG_STATUS.GIVEN || s === MED_LOG_STATUS.REFUSED || s === MED_LOG_STATUS.HELD

/**
 * The med pass board — one composed read, the /census, /service and /checks
 * pattern. A band cannot disagree with the resident it came from because both
 * are built here from the same expansion.
 *
 * NO DRUG NAME CROSSES THIS BOUNDARY, and that is a privacy decision rather
 * than an omission. This payload is what a shared house phone renders in a
 * hallway; it carries a resident's name and a count, which is what running a
 * pass needs. The medications themselves come from passFor() below, one
 * resident at a time, when somebody deliberately opens the sheet.
 */
export async function houseMeds({ date, now = new Date() } = {}) {
  const dateKey = date ?? facilityToday(now)
  const { medications, logsByKey } = await dayContext(dateKey)
  const doses = expandDoses(medications, dateKey, logsByKey, now)

  // Grouped by the wall-clock time they share, which is what a "pass" is. It
  // needs no entity of its own: the times cluster naturally because the house
  // writes regimens around its own routine.
  const byTime = new Map()
  for (const d of doses) {
    if (!byTime.has(d.time)) byTime.set(d.time, [])
    byTime.get(d.time).push(d)
  }

  const passes = [...byTime.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([time, group]) => {
      const byStay = new Map()
      for (const d of group) {
        if (!byStay.has(d.stayId)) byStay.set(d.stayId, [])
        byStay.get(d.stayId).push(d)
      }
      const residents = [...byStay.values()]
        .map((rows) => {
          const stay = rows[0].medication.stay
          const bed = stay.bedAssignments[0]?.bed ?? null
          return {
            stayId: stay.id,
            residentId: stay.resident.id,
            fullName: fullName(stay.resident),
            apartmentName: bed?.apartment?.name ?? null,
            bedLabel: bed?.label ?? null,
            total: rows.length,
            marked: rows.filter((r) => isMarked(r.state)).length,
            due: rows.filter((r) => r.state === MED_DOSE_STATE.DUE).length,
            missed: rows.filter((r) => r.state === MED_DOSE_STATE.MISSED).length,
            upcoming: rows.filter((r) => r.state === MED_DOSE_STATE.UPCOMING).length,
          }
        })
        // Whoever still needs something first; then alphabetical, so a settled
        // list does not reshuffle itself every thirty seconds.
        .sort(
          (a, b) =>
            b.due - a.due || b.missed - a.missed || a.fullName.localeCompare(b.fullName),
        )

      const marked = group.filter((d) => isMarked(d.state)).length
      const due = group.filter((d) => d.state === MED_DOSE_STATE.DUE).length
      const missed = group.filter((d) => d.state === MED_DOSE_STATE.MISSED).length
      return {
        time,
        label: formatFacilityTime(group[0].scheduledFor),
        startsAt: group[0].scheduledFor,
        total: group.length,
        marked,
        due,
        missed,
        upcoming: group.length - marked - due - missed,
        // The pass's own standing, from the doses under it. DUE beats MISSED:
        // a pass with one of each still has something somebody can act on.
        state: due
          ? MED_DOSE_STATE.DUE
          : missed
            ? MED_DOSE_STATE.MISSED
            : marked === group.length
              ? MED_DOSE_STATE.GIVEN
              : MED_DOSE_STATE.UPCOMING,
        residents,
      }
    })

  return {
    now,
    date: dateKey,
    graceMs: MED_PASS_GRACE_MS,
    figures: {
      scheduled: doses.length,
      marked: doses.filter((d) => isMarked(d.state)).length,
      due: doses.filter((d) => d.state === MED_DOSE_STATE.DUE).length,
      missed: doses.filter((d) => d.state === MED_DOSE_STATE.MISSED).length,
      residents: new Set(doses.map((d) => d.stayId)).size,
    },
    passes,
  }
}

/**
 * One resident's doses for a date — the pass sheet's read, and THE ONLY PLACE
 * on this module's operational surface where a medication is named.
 *
 * Deliberately not fetch-on-reveal the way GET /screens/:id is. A screen queue
 * lists many people and hiding the results is a real boundary; a med sheet is
 * the tool for DOING the pass, so a curtain that closes mid-hallway is friction
 * rather than protection. The audit unit becomes "opened this resident's med
 * pass" instead of "read this medication", which on a sheet about one named
 * person is the right grain — module 1's argument for techs seeing the Clinical
 * group at all.
 */
export async function passFor(stayId, { date, now = new Date() } = {}) {
  const dateKey = date ?? facilityToday(now)
  const stay = await prisma.stay.findUnique({
    where: { id: stayId },
    select: { id: true, status: true, resident: NAME },
  })
  if (!stay) throw new HttpError(404, 'Resident not found')

  const { medications, logsByKey } = await dayContext(dateKey, { stayId })
  const doses = expandDoses(medications, dateKey, logsByKey, now)

  return {
    now,
    date: dateKey,
    stayId: stay.id,
    residentId: stay.resident.id,
    fullName: fullName(stay.resident),
    hasActiveStay: stay.status === STAY_STATUS.ACTIVE,
    doses: doses.map(shapeDose),
    // As-needed medications are not doses and never appear on the board. They
    // are listed here so the sheet can offer one when a resident asks.
    prn: medications.filter((m) => m.isPrn).map(shapeMedication),
  }
}

function shapeDose(d) {
  return {
    medicationId: d.medicationId,
    medicationName: d.medication.name,
    dosage: d.medication.dosage,
    instructions: d.medication.instructions,
    time: d.time,
    label: formatFacilityTime(d.scheduledFor),
    scheduledFor: d.scheduledFor,
    state: d.state,
    log: d.log
      ? {
          id: d.log.id,
          status: d.log.status,
          note: d.log.note,
          observedBy: d.log.observedBy,
          recordedBy: d.log.recordedBy,
          recordedAt: d.log.createdAt,
          // A dose recorded well after its slot is not falsified, only late —
          // and the pair of instants is what says so.
          late: d.log.createdAt > new Date(d.scheduledFor.getTime() + MED_PASS_GRACE_MS),
          amended: Boolean(d.log.supersedesId),
          amendmentReason: d.log.amendmentReason,
        }
      : null,
  }
}

function shapeMedication(m) {
  return {
    id: m.id,
    name: m.name,
    dosage: m.dosage,
    instructions: m.instructions,
    prescriber: m.prescriber,
    pharmacy: m.pharmacy,
    times: m.times,
    isPrn: m.isPrn,
    startsOn: m.startsOn,
    endsOn: m.endsOn,
    endReason: m.endReason,
  }
}

/**
 * Record a whole resident's pass in one write, never one request per dose —
 * the roll sheet and the apartment check both do this and for the same reason:
 * a hallway with bad signal turns six requests into a half-recorded pass.
 *
 * ALWAYS TODAY. The date is not a parameter, which is the no-backfill rule made
 * structural: a dose missed on Tuesday cannot be given on Thursday, and
 * recording it then is falsifying rather than catching up. Yesterday's misses
 * are history and read as history.
 *
 * A LATE dose may still be recorded. That is deliberately different from
 * refusing it: the observation genuinely happened, and `scheduledFor` against
 * `createdAt` says exactly how late it was without anyone having to claim
 * otherwise. What is refused is a dose whose time has NOT YET COME — that is
 * recording an observation nobody has made, the same reasoning as
 * ApartmentCheck.checkedAt always being the server clock.
 */
export async function recordDoses({ stayId, entries, observedById }, actorId) {
  if (!entries.length) throw new HttpError(400, 'Nothing to record.')

  return runInTransaction(async () => {
    const now = new Date()
    const dateKey = facilityToday(now)

    const stay = await prisma.stay.findUnique({
      where: { id: stayId },
      select: { id: true, status: true },
    })
    if (!stay) throw new HttpError(404, 'Resident not found')
    if (stay.status !== STAY_STATUS.ACTIVE) {
      throw new HttpError(409, 'This resident is no longer in the programme.')
    }

    const observer = await prisma.user.findFirst({
      where: { id: observedById, deletedAt: null, isActive: true },
      select: { id: true },
    })
    if (!observer) throw new HttpError(400, 'Invalid observing staff member')

    // Re-derived INSIDE the transaction, from the same expansion the sheet was
    // built from. A medication discontinued between sheet-load and Save is a
    // refusal and a reload, never a dose recorded against an instruction that
    // no longer stands.
    const medications = await prisma.medication.findMany({
      where: { ...activeOnDate(dateKey), stayId },
    })
    const logs = await prisma.medLog.findMany({
      where: {
        medicationId: { in: medications.map((m) => m.id) },
        scheduledFor: facilityDayBounds(dateKey),
        ...CURRENT_ONLY,
      },
      select: { medicationId: true, scheduledFor: true },
    })
    const logsByKey = new Map(logs.map((l) => [doseKey(l.medicationId, l.scheduledFor), l]))
    const doses = expandDoses(medications, dateKey, logsByKey, now)
    const byKey = new Map(doses.map((d) => [`${d.medicationId}|${d.time}`, d]))

    const seen = new Set()
    const data = []
    for (const e of entries) {
      const key = `${e.medicationId}|${e.time}`
      if (seen.has(key)) throw new HttpError(400, 'That dose appears twice on this pass.')
      seen.add(key)

      const dose = byKey.get(key)
      if (!dose) {
        throw new HttpError(
          409,
          'That dose is no longer on this resident’s list. Reload and try again.',
        )
      }
      if (dose.state === MED_DOSE_STATE.UPCOMING) {
        throw new HttpError(409, `${dose.medication.name} is not due until ${formatFacilityTime(dose.scheduledFor)}.`)
      }
      if (dose.log) {
        throw new HttpError(
          409,
          'That dose has already been recorded. Correct it with an amendment rather than a second log.',
        )
      }
      if (e.status !== MED_LOG_STATUS.GIVEN && !e.note?.trim()) {
        throw new HttpError(400, 'A dose not given needs a reason.')
      }

      data.push({
        medicationId: dose.medicationId,
        stayId,
        scheduledFor: dose.scheduledFor,
        status: e.status,
        note: e.note?.trim() || null,
        observedById,
        recordedById: actorId,
        // Snapshots, so a later change to the med list cannot rewrite what was
        // actually handed over.
        medicationName: dose.medication.name,
        dosage: dose.medication.dosage,
      })
    }

    await prisma.medLog.createMany({ data })
    return { recorded: data.length }
  })
}

/**
 * Record an as-needed dose. Separate from recordDoses because a PRN dose
 * answers no slot: `scheduledFor` is null, and the same medication may honestly
 * be taken twice in one day — which is exactly why the one-live-log-per-dose
 * trigger exempts a null slot.
 */
export async function recordPrnDose({ medicationId, status, note, observedById }, actorId) {
  return runInTransaction(async () => {
    const med = await prisma.medication.findFirst({
      where: { id: medicationId, deletedAt: null },
      include: { stay: { select: { id: true, status: true } } },
    })
    if (!med) throw new HttpError(404, 'Medication not found')
    if (!med.isPrn) {
      throw new HttpError(409, 'That medication is scheduled — record it on the pass instead.')
    }
    if (med.stay.status !== STAY_STATUS.ACTIVE) {
      throw new HttpError(409, 'This resident is no longer in the programme.')
    }
    if (med.endsOn && utcToDateKey(med.endsOn) < facilityToday()) {
      throw new HttpError(409, 'That medication has been discontinued.')
    }
    if (status !== MED_LOG_STATUS.GIVEN && !note?.trim()) {
      throw new HttpError(400, 'A dose not given needs a reason.')
    }

    const observer = await prisma.user.findFirst({
      where: { id: observedById, deletedAt: null, isActive: true },
      select: { id: true },
    })
    if (!observer) throw new HttpError(400, 'Invalid observing staff member')

    return prisma.medLog.create({
      data: {
        medicationId: med.id,
        stayId: med.stayId,
        scheduledFor: null,
        status,
        note: note?.trim() || null,
        observedById,
        recordedById: actorId,
        medicationName: med.name,
        dosage: med.dosage,
      },
    })
  })
}

/**
 * Correct a dose. A PURE INSERT pointing at the original, which stays — the
 * amendment pattern the schema footer prescribes and modules 4, 5 and 7 already
 * use. `medicationId`, `stayId` and `scheduledFor` are carried VERBATIM: an
 * amendment corrects what was observed, never which dose it was.
 */
export async function amendLog(id, input, actorId) {
  return runInTransaction(async () => {
    const original = await prisma.medLog.findUnique({
      where: { id },
      include: { supersededBy: { select: { id: true } }, medication: { select: { name: true, dosage: true } } },
    })
    if (!original) throw new HttpError(404, 'Dose not found')
    if (original.supersededBy) {
      throw new HttpError(409, 'This dose has already been amended. Correct the amendment instead.')
    }

    const status = input.status ?? original.status
    const note = input.note !== undefined ? input.note?.trim() || null : original.note
    if (status !== MED_LOG_STATUS.GIVEN && !note) {
      throw new HttpError(400, 'A dose not given needs a reason.')
    }

    const observedById = input.observedById ?? original.observedById
    const observer = await prisma.user.findFirst({
      where: { id: observedById, deletedAt: null, isActive: true },
      select: { id: true },
    })
    if (!observer) throw new HttpError(400, 'Invalid observing staff member')

    return prisma.medLog.create({
      data: {
        medicationId: original.medicationId,
        stayId: original.stayId,
        scheduledFor: original.scheduledFor,
        status,
        note,
        observedById,
        recordedById: actorId,
        // The snapshot travels with the amendment. Re-reading the medication
        // here would let a dose raised last week be silently restated at
        // today's figure, which is the whole reason these columns exist.
        medicationName: original.medicationName,
        dosage: original.dosage,
        supersedesId: original.id,
        amendmentReason: input.amendmentReason.trim(),
      },
    })
  })
}

/**
 * What the bell counts. DUE doses only, never MISSED — and that is the
 * decision, not an oversight.
 *
 * A derived item has to be clearable by doing the thing it names, or it stops
 * being read. A DUE dose is one somebody can still walk down the hall and
 * record. A MISSED dose can never be recorded (see recordDoses' no-backfill
 * rule), so an item counting them would sit in the bell forever with nothing
 * anybody could do about it — the "dismissed into a lie" failure inverted.
 * Missed doses are evidence and read as evidence, on the board and on the
 * record.
 *
 * COUNTS AND A TIME ONLY. No resident name and no medication ever leaves this
 * function: module 13 demands a separate think before anything from module 5 or
 * 6 goes near the bell, and this is its answer. A count says the pass has not
 * been run; it says nothing about who takes what.
 */
export async function unmarkedDoses(now = new Date()) {
  const dateKey = facilityToday(now)
  const { medications, logsByKey } = await dayContext(dateKey)
  const due = expandDoses(medications, dateKey, logsByKey, now).filter(
    (d) => d.state === MED_DOSE_STATE.DUE,
  )
  if (!due.length) return null

  const earliest = due[0]
  return {
    count: due.length,
    residents: new Set(due.map((d) => d.stayId)).size,
    label: formatFacilityTime(earliest.scheduledFor),
    at: earliest.scheduledFor,
  }
}

const encodeCursor = (l) => Buffer.from(`${l.createdAt.toISOString()}|${l.id}`).toString('base64url')

function decodeCursor(s) {
  const raw = Buffer.from(s, 'base64url').toString()
  const split = raw.indexOf('|')
  const t = split > 0 ? new Date(raw.slice(0, split)) : null
  const id = split > 0 ? raw.slice(split + 1) : ''
  if (!t || Number.isNaN(t.getTime()) || !id) throw new HttpError(400, 'Invalid cursor')
  return { t, id }
}

/**
 * The resident record's Medications section — the current list over the dose
 * trail. Read-only; doses are recorded and corrected on the med pass board, the
 * same split every other rail section follows.
 *
 * Active stay only, the Service/Ledger/Schedule/Checks precedent. Keyset
 * paginated because a resident on three medications writes six rows a day.
 *
 * Medications ARE named here, unlike anywhere on the board — a record page is a
 * deliberate navigation to one person somebody already chose, which is module
 * 5's own justification for showing screen results inline on the record while
 * hiding them on the queue.
 */
export async function residentMeds(residentId, { date, cursor, limit = 50 } = {}) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    select: { id: true },
  })
  if (!stay) {
    return { hasActiveStay: false, stayId: null, medications: [], logs: [], nextCursor: null }
  }

  const c = !date && cursor ? decodeCursor(cursor) : null
  const rows = await prisma.medLog.findMany({
    where: {
      stayId: stay.id,
      ...CURRENT_ONLY,
      ...(date && { createdAt: facilityDayBounds(date) }),
      ...(c && {
        OR: [{ createdAt: { lt: c.t } }, { createdAt: c.t, id: { lt: c.id } }],
      }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: { observedBy: WHO, recordedBy: WHO },
  })

  const page = rows.slice(0, limit)
  const medications = await prisma.medication.findMany({
    where: { stayId: stay.id, deletedAt: null },
    orderBy: [{ endsOn: 'asc' }, { name: 'asc' }],
  })

  return {
    hasActiveStay: true,
    stayId: stay.id,
    // The list rides on page one only — Load-more pages skip the extra query
    // and the client keeps the list it already has.
    medications: c ? null : medications.map(shapeMedication),
    logs: page.map((l) => ({
      id: l.id,
      medicationId: l.medicationId,
      // The snapshot, deliberately, not the medication's current name.
      medicationName: l.medicationName,
      dosage: l.dosage,
      scheduledFor: l.scheduledFor,
      status: l.status,
      note: l.note,
      observedBy: l.observedBy,
      recordedBy: l.recordedBy,
      recordedAt: l.createdAt,
      amended: Boolean(l.supersedesId),
      amendmentReason: l.amendmentReason,
    })),
    nextCursor: !date && rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The med list. Managers only at the route — a standing instruction about
// somebody's medication is not a hallway act, the same line as setting a
// service-hours target or setting the schedule.
// ─────────────────────────────────────────────────────────────────────────────

/** Refuses a shape the database would refuse anyway, with a sentence instead. */
function validateShape({ isPrn, times }) {
  if (isPrn && times.length) {
    throw new HttpError(400, 'An as-needed medication has no scheduled times.')
  }
  if (!isPrn && !times.length) {
    throw new HttpError(400, 'A scheduled medication needs at least one time.')
  }
  if (new Set(times).size !== times.length) {
    throw new HttpError(400, 'That medication lists the same time twice.')
  }
}

export async function addMedication(residentId, input, actorId) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    select: { id: true },
  })
  if (!stay) throw new HttpError(409, 'This resident has no active stay.')

  const times = [...(input.times ?? [])].sort()
  validateShape({ isPrn: input.isPrn, times })

  const med = await prisma.medication.create({
    data: {
      stayId: stay.id,
      name: input.name.trim(),
      dosage: input.dosage.trim(),
      instructions: input.instructions?.trim() || null,
      prescriber: input.prescriber?.trim() || null,
      pharmacy: input.pharmacy?.trim() || null,
      times,
      isPrn: input.isPrn,
      startsOn: dateKeyToUtc(input.startsOn),
      addedById: actorId,
    },
  })
  return shapeMedication(med)
}

/**
 * Edit a medication. Freely, and with no freeze once doses are logged — which
 * is the design working rather than a concession. MedLog snapshots the name and
 * dosage at the dose, so raising somebody's dose today cannot restate what was
 * handed over last week. That snapshot is what buys this table its editability;
 * without it every field here would have to freeze the way a schedule event's
 * shape does.
 */
export async function editMedication(id, input) {
  const med = await prisma.medication.findFirst({ where: { id, deletedAt: null } })
  if (!med) throw new HttpError(404, 'Medication not found')

  const next = {}
  for (const field of ['name', 'dosage']) {
    if (input[field] !== undefined) next[field] = input[field].trim()
  }
  for (const field of ['instructions', 'prescriber', 'pharmacy']) {
    if (input[field] !== undefined) next[field] = input[field]?.trim() || null
  }
  if (input.startsOn !== undefined) next.startsOn = dateKeyToUtc(input.startsOn)
  if (input.times !== undefined || input.isPrn !== undefined) {
    const times = [...(input.times ?? med.times)].sort()
    const isPrn = input.isPrn ?? med.isPrn
    validateShape({ isPrn, times })
    next.times = times
    next.isPrn = isPrn
  }

  // The verify-schedule.js precedent: an empty patch is a 400, including when
  // every field sent already matches. "Nothing changed" is the honest reading.
  if (!Object.keys(next).length) throw new HttpError(400, 'Nothing to change.')

  return shapeMedication(await prisma.medication.update({ where: { id }, data: next }))
}

/** The last facility date this medication has a live dose recorded on. */
async function lastRecordedDate(medicationId) {
  const last = await prisma.medLog.findFirst({
    where: { medicationId, ...CURRENT_ONLY },
    orderBy: [{ createdAt: 'desc' }],
    select: { scheduledFor: true, createdAt: true },
  })
  if (!last) return null
  const at = last.scheduledFor ?? last.createdAt
  return facilityToday(at)
}

/**
 * Discontinue a medication — the ONLY way one ever ends.
 *
 * `endsOn` is never earlier than the last recorded dose, and that is the
 * easiest bug in this module to ship: reads filter medications to those
 * standing on a date, so shortening the window past a recorded dose orphans it
 * exactly the way `expand()` gating on `occursOn` before it looks at session
 * rows orphans attendance. Ending a medication is the SANCTIONED act, which is
 * what makes the guard worth stating.
 */
export async function discontinueMedication(id, { endsOn, endReason }) {
  const med = await prisma.medication.findFirst({ where: { id, deletedAt: null } })
  if (!med) throw new HttpError(404, 'Medication not found')
  if (med.endsOn) throw new HttpError(409, 'That medication has already been discontinued.')

  const last = await lastRecordedDate(id)
  if (last && endsOn < last) {
    throw new HttpError(
      409,
      `This medication has a dose recorded on ${last}. It cannot be ended before then.`,
    )
  }
  if (endsOn < utcToDateKey(med.startsOn)) {
    throw new HttpError(409, 'A medication cannot end before it starts.')
  }

  return shapeMedication(
    await prisma.medication.update({
      where: { id },
      data: { endsOn: dateKeyToUtc(endsOn), endReason: endReason.trim() },
    }),
  )
}

/**
 * Remove a medication added in error. Only while NOTHING has been recorded
 * against it — the sign-out and schedule-event shape, fixable in error but only
 * while it is not yet evidence.
 *
 * Soft-deleting one that carries doses would make the soft-delete extension
 * filter it out of every read and silently erase its dose history, which is the
 * identical failure the ScheduleEvent rule warns about. Once anything is
 * logged, discontinuing is the operation and deleting is not one.
 */
export async function deleteMedication(id) {
  const med = await prisma.medication.findFirst({ where: { id, deletedAt: null } })
  if (!med) throw new HttpError(404, 'Medication not found')

  const logged = await prisma.medLog.count({ where: { medicationId: id } })
  if (logged) {
    throw new HttpError(
      409,
      'This medication has doses recorded against it. Discontinue it instead — deleting it would hide those doses.',
    )
  }

  await prisma.medication.update({ where: { id }, data: { deletedAt: new Date() } })
  return { id }
}
