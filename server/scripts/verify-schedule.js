/**
 * Schedule and events — end to end through the real HTTP API.
 *
 * What this proves: one event has one time and one roster, however many cohorts
 * attend; a both-cohorts event is stored as two occurrences with identical
 * timing and renders as ONE card in a shared band, in neither lane; cohort
 * integrity holds through the API and at the composite foreign key; recurrence
 * expands to exactly the right dates and a weekly 6pm stays 6pm across a DST
 * boundary; sessions are materialized lazily and only on dates the rule covers;
 * a tech may take a roll but not set the schedule; one roll routes each mark to
 * its own cohort's session and stamps both; a shared session is TAKEN only by
 * unanimity; a mark survives its roster row; and a resident on nothing gets an
 * empty schedule rather than their cohort's.
 *
 * Run after `node scripts/seed.js`. Creates events and does not clean up, so
 * reseed afterwards.
 */
import { createApp } from '../src/app.js'
import { formatFacilityTime, facilityToday } from '../src/lib/facilityTime.js'
import { addDays } from '../src/services/schedule/expand.js'

let pass = 0
let fail = 0
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++ }
const bad = (n, d) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`); fail++ }
const PW = 'soberlife-dev-1234'

/** `recorded` from getEvent, in a sentence, for an assertion label. */
function recordedSummary(r) {
  return `${r.marked} marks, ${r.cancelled} cancelled, last ${r.lastRecordedDate}`
}

/** The most recent date on or before `from` falling on `weekday` (0=Sun). */
function lastWeekdayOnOrBefore(from, weekday) {
  let d = from
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== weekday) d = addDays(d, -1)
  return d
}

async function main() {
  const server = createApp().listen(0)
  const base = `http://localhost:${server.address().port}`

  const login = async (email) => {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PW }),
    })
    return (r.headers.get('set-cookie') ?? '').split(';')[0]
  }
  const as = (cookie) => async (path, init = {}) => {
    const r = await fetch(base + path, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
    })
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
  }

  const manager = as(await login('manager@facility.test'))
  const tech = as(await login('tech@facility.test'))

  const men = (await manager('/schedule/candidates?cohort=MEN')).body.residents
  const allWomen = (await manager('/schedule/candidates?cohort=WOMEN')).body.residents
  const today = facilityToday()

  // Joy is the seed's resident on no events, and the last assertion in this
  // file depends on her staying that way. Keeping her off every roster here is
  // what stops this suite quietly destroying its own fixture.
  const women = allWomen.filter((w) => w.fullName !== 'Joy Nakamura')

  const sessionsOf = (band) => band.days.flatMap((d) => d.sessions)
  const everySession = (b) => [...sessionsOf(b.shared), ...b.lanes.flatMap(sessionsOf)]

  // ── Gates and roles ─────────────────────────────────────────────────────
  console.log('\n\x1b[1mGates and roles\x1b[0m')

  const anon = await fetch(`${base}/schedule`)
  anon.status === 401 ? ok('anonymous is refused') : bad('anon blocked', anon.status)

  const techRead = await tech('/schedule?days=7')
  techRead.status === 200 && Array.isArray(techRead.body?.lanes)
    ? ok('a tech can read the schedule')
    : bad('tech reads schedule', JSON.stringify(techRead.body))

  const techCandidates = await tech('/schedule/candidates?cohort=MEN')
  techCandidates.status === 403
    ? ok('a tech cannot list roster candidates — setting the schedule is a manager job')
    : bad('tech candidates refused', techCandidates.status)

  // ONE time, ONE roster, both cohorts. The flagship shape.
  const sharedBody = {
    title: 'Verify — Shared Group',
    location: 'Common room',
    cohorts: ['MEN', 'WOMEN'],
    startsAtLocal: '19:00',
    durationMinutes: 90,
    recurrence: 'WEEKLY',
    weekdays: [2],
    startsOn: '2026-05-05',
    stayIds: [...men.slice(0, 2), ...women].map((r) => r.stayId),
  }

  const techCreate = await tech('/schedule/events', { method: 'POST', body: JSON.stringify(sharedBody) })
  techCreate.status === 403
    ? ok('a tech cannot create an event')
    : bad('tech create refused', techCreate.status)

  const created = await manager('/schedule/events', { method: 'POST', body: JSON.stringify(sharedBody) })
  created.status === 201 && created.body?.cohorts?.length === 2
    ? ok('a manager creates a both-cohorts event from one flat payload')
    : bad('manager creates event', `${created.status} ${JSON.stringify(created.body)}`)

  const sharedId = created.body.id
  const menOcc = created.body.occurrences.find((o) => o.cohort === 'MEN')
  const womenOcc = created.body.occurrences.find((o) => o.cohort === 'WOMEN')

  const { prisma } = await import('../src/db/client.js')
  const { runAsSystem } = await import('../src/lib/dbContext.js')

  // ── The split ───────────────────────────────────────────────────────────
  console.log('\n\x1b[1mOne event, one time, one roster\x1b[0m')

  const rows = await runAsSystem(async () =>
    prisma.scheduleOccurrence.findMany({ where: { eventId: sharedId }, orderBy: { cohort: 'asc' } }),
  )
  const identical =
    rows.length === 2 &&
    new Set(rows.map((r) => r.startsAtLocal)).size === 1 &&
    new Set(rows.map((r) => r.durationMinutes)).size === 1 &&
    new Set(rows.map((r) => r.recurrence)).size === 1 &&
    new Set(rows.map((r) => JSON.stringify(r.weekdays))).size === 1 &&
    new Set(rows.map((r) => String(r.startsOn))).size === 1 &&
    new Set(rows.map((r) => String(r.endsOn))).size === 1
  identical
    ? ok('it becomes two occurrences carrying IDENTICAL timing on all six fields')
    : bad('identical timing', JSON.stringify(rows.map((r) => [r.cohort, r.startsAtLocal, r.durationMinutes])))

  const attendeeRows = await runAsSystem(async () =>
    prisma.scheduleAttendee.findMany({
      where: { occurrenceId: { in: [menOcc.id, womenOcc.id] } },
      include: { stay: { select: { cohort: true } } },
    }),
  )
  const splitRight = attendeeRows.every((a) => a.cohort === a.stay.cohort)
    && attendeeRows.filter((a) => a.occurrenceId === menOcc.id).length === 2
    && attendeeRows.filter((a) => a.occurrenceId === womenOcc.id).length === women.length
  splitRight
    ? ok('one combined roster splits onto the right occurrence by each resident’s own cohort')
    : bad('roster split', JSON.stringify(attendeeRows.map((a) => [a.cohort, a.stay.cohort])))

  const outsideCohorts = await manager('/schedule/events', {
    method: 'POST',
    body: JSON.stringify({ ...sharedBody, title: 'Verify — Outside', cohorts: ['MEN'] }),
  })
  outsideCohorts.status === 409 && /not in the cohorts/i.test(outsideCohorts.body?.error ?? '')
    ? ok(`a resident outside the event's cohorts is refused — "${outsideCohorts.body.error}"`)
    : bad('outside cohorts refused', `${outsideCohorts.status} ${JSON.stringify(outsideCohorts.body)}`)

  const leaked = [...men, ...allWomen].some((r) =>
    JSON.stringify(outsideCohorts.body).includes(r.fullName),
  )
  !leaked
    ? ok('and the refusal names a cohort, never a resident')
    : bad('name in error body', JSON.stringify(outsideCohorts.body))

  const dupe = await manager('/schedule/events', {
    method: 'POST',
    body: JSON.stringify({
      ...sharedBody,
      title: 'Verify — Dupe',
      stayIds: [men[0].stayId, men[0].stayId],
    }),
  })
  dupe.status === 400
    ? ok('the same resident twice in one roster is a 400, not a unique-index 500')
    : bad('duplicate roster refused', `${dupe.status} ${JSON.stringify(dupe.body)}`)

  const combined = await manager('/schedule/candidates?cohort=MEN,WOMEN')
  const sorted = combined.body?.residents ?? []
  combined.status === 200 &&
  sorted.length === men.length + allWomen.length &&
  new Set(sorted.map((r) => r.cohort)).size === 2 &&
  sorted.every((r, i) => i === 0 || sorted[i - 1].fullName.localeCompare(r.fullName) <= 0)
    ? ok(`?cohort=MEN,WOMEN returns one sorted list spanning both (${sorted.length})`)
    : bad('combined candidates', `${combined.status} ${sorted.length}`)

  const noCohort = await manager('/schedule/candidates')
  noCohort.status === 400
    ? ok('a missing cohort param is still 400 — never a silent "everyone"')
    : bad('missing cohort refused', noCohort.status)

  // ── The board renders it once ───────────────────────────────────────────
  console.log('\n\x1b[1mThe board renders it once\x1b[0m')

  const board = (await tech(`/schedule?date=${today}&days=14`)).body

  board.lanes.length === 2 && board.lanes[0].cohort === 'MEN' && board.lanes[1].cohort === 'WOMEN'
    ? ok('both lanes are always present, in a fixed order')
    : bad('lane shape', JSON.stringify(board.lanes?.map((l) => l.cohort)))

  !('sessions' in board) && board.shared && Array.isArray(board.shared.days)
    ? ok('no flat session array exists — lanes and the shared band are date buckets')
    : bad('no flat array', Object.keys(board).join(','))

  const laneSessions = board.lanes.flatMap(sessionsOf)
  laneSessions.every((s) => s.cohorts.length === 1)
    ? ok('every lane session is single-cohort — the accidental merge stays impossible')
    : bad('lane purity', 'a lane holds a multi-cohort session')

  const sharedHits = sessionsOf(board.shared).filter((s) => s.eventId === sharedId)
  const laneHits = laneSessions.filter((s) => s.eventId === sharedId)
  sharedHits.length > 0 && laneHits.length === 0
    ? ok(`the shared event is in the band (${sharedHits.length} dates) and in NEITHER lane`)
    : bad('shared excluded from lanes', `${sharedHits.length} shared, ${laneHits.length} in lanes`)

  const perDate = everySession(board)
    .filter((s) => s.eventId === sharedId)
    .reduce((m, s) => m.set(s.date, (m.get(s.date) ?? 0) + 1), new Map())
  const counts = [...perDate.values()]
  counts.length > 0 && counts.every((n) => n === 1)
    ? ok('it appears exactly once per date across the whole response')
    : bad('once per date', JSON.stringify([...perDate]))

  const one = sharedHits[0]
  one && one.cohorts.length === 2 && one.cohort === undefined && !('occurrenceId' in one && one.occurrenceId)
    ? ok('a shared session carries `cohorts` and deliberately no scalar `cohort`')
    : bad('shared session shape', JSON.stringify(Object.keys(one ?? {})))

  one && one.rosterCount === 2 + women.length
    ? ok(`shared rosterCount is the sum of both sides (${one.rosterCount})`)
    : bad('summed roster', one?.rosterCount)

  const anyName = [...men, ...allWomen].some((r) => JSON.stringify(board).includes(r.fullName))
  !anyName
    ? ok('the board carries counts and never resident names')
    : bad('names on the board', 'a resident name is on the wire')

  // ── Recurrence and expansion ────────────────────────────────────────────
  console.log('\n\x1b[1mRecurrence and expansion\x1b[0m')

  const onceDate = addDays(today, 3)
  const once = await manager('/schedule/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Verify — One off',
      cohorts: ['MEN'],
      startsAtLocal: '10:00', durationMinutes: 300,
      recurrence: 'ONCE', weekdays: [], startsOn: onceDate,
      stayIds: men.slice(0, 1).map((m) => m.stayId),
    }),
  })

  const ended = await manager('/schedule/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Verify — Ended series',
      cohorts: ['MEN'],
      startsAtLocal: '09:00', durationMinutes: 30,
      recurrence: 'WEEKLY', weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsOn: today, endsOn: addDays(today, 2), stayIds: [],
    }),
  })

  const future = await manager('/schedule/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Verify — Starts later',
      cohorts: ['WOMEN'],
      startsAtLocal: '09:00', durationMinutes: 30,
      recurrence: 'WEEKLY', weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsOn: addDays(today, 30), stayIds: [],
    }),
  })

  // Fetched AFTER every event above exists. Reading it earlier made the two
  // absence assertions below pass on stale data — they were not testing
  // anything, the same trap the cohort assertion in verify-residents fell into.
  const wide = (await tech(`/schedule?date=${today}&days=14`)).body
  const wideAll = everySession(wide)

  const onceHits = wideAll.filter((s) => s.eventId === once.body.id)
  onceHits.length === 1 && onceHits[0].date === onceDate
    ? ok('a one-off appears on exactly its date and nowhere else')
    : bad('one-off expansion', JSON.stringify(onceHits.map((h) => h.date)))

  const weeklyHits = wideAll.filter((s) => s.eventId === sharedId)
  weeklyHits.length >= 2 && weeklyHits.every((s) => new Date(`${s.date}T00:00:00Z`).getUTCDay() === 2)
    ? ok(`a weekly occurrence lands only on its weekday (${weeklyHits.length} Tuesdays in 14 days)`)
    : bad('weekly expansion', JSON.stringify(weeklyHits.map((h) => h.date)))

  wideAll.filter((s) => s.eventId === ended.body.id).length === 3
    ? ok('endsOn stops a series — 3 days, not 14')
    : bad('endsOn honoured', wideAll.filter((s) => s.eventId === ended.body.id).length)

  !wideAll.some((s) => s.eventId === future.body.id)
    ? ok('a future startsOn hides the series until it begins')
    : bad('startsOn honoured', 'a not-yet-started series rendered')

  const huge = (await tech(`/schedule?date=${today}&days=3650`)).body
  huge.days.length === 62
    ? ok('an oversized window is clamped to SCHEDULE_MAX_DAYS, not honoured')
    : bad('window clamped', `${huge.days.length} days`)

  const dst = await manager('/schedule/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Verify — DST',
      cohorts: ['MEN'],
      startsAtLocal: '18:00', durationMinutes: 60,
      recurrence: 'WEEKLY', weekdays: [0], startsOn: '2026-10-25', endsOn: '2026-11-08',
      stayIds: [],
    }),
  })
  const dstHits = everySession((await tech('/schedule?date=2026-10-25&days=15')).body)
    .filter((s) => s.eventId === dst.body.id)
  dstHits.length === 3 && dstHits.every((s) => formatFacilityTime(s.startsAt) === '6:00 PM')
    ? ok('a weekly 6pm reads 6:00 PM on both sides of the DST boundary')
    : bad('DST stability', dstHits.map((s) => `${s.date} ${formatFacilityTime(s.startsAt)}`).join(', '))

  // The board-vs-record "one expander" assertion lived here until 2026-08-08.
  // It is GONE because the coupling it guarded is: the resident record no longer
  // expands anything, so there is no second read to disagree with. What replaced
  // it is the check further down that no `upcoming` key rides on the record at
  // all — a stronger guarantee than the two agreeing.
  //
  // The one-expander property still holds where it still applies: the dashboard
  // calls scheduleWindow() and verify-dashboard.js asserts its window matches
  // the board's.

  // ── Lazy materialization ────────────────────────────────────────────────
  console.log('\n\x1b[1mLazy materialization\x1b[0m')

  const countSessions = () =>
    runAsSystem(async () =>
      prisma.scheduleSession.count({ where: { occurrenceId: { in: [menOcc.id, womenOcc.id] } } }),
    )

  const eager = await countSessions()
  eager === 0
    ? ok('a freshly created weekly event has zero session rows — every date is computed')
    : bad('no eager rows', eager)

  const tuesday = weeklyHits[0].date
  const roster = [...men.slice(0, 2), ...women]
  const roll = await tech('/schedule/attendance', {
    method: 'POST',
    body: JSON.stringify({
      eventId: sharedId,
      date: tuesday,
      marks: roster.map((r, i) => ({ stayId: r.stayId, status: i === 0 ? 'ATTENDED' : 'EXCUSED' })),
    }),
  })
  roll.status === 200
    ? ok('a TECH can take the roll — the person running the group is the one holding the phone')
    : bad('tech takes roll', `${roll.status} ${JSON.stringify(roll.body)}`)

  const afterRoll = await countSessions()
  afterRoll === 2
    ? ok('one roll on a both-cohorts event materializes BOTH sessions')
    : bad('both materialized', afterRoll)

  await tech('/schedule/attendance', {
    method: 'POST',
    body: JSON.stringify({
      eventId: sharedId, date: tuesday,
      marks: [{ stayId: roster[0].stayId, status: 'ABSENT' }],
    }),
  })
  const afterSecond = await countSessions()
  afterSecond === 2
    ? ok('taking it a second time does not create more rows')
    : bad('idempotent materialization', afterSecond)

  const wrongDate = await tech('/schedule/attendance', {
    method: 'POST',
    body: JSON.stringify({
      eventId: sharedId, date: addDays(tuesday, 1),
      marks: [{ stayId: roster[0].stayId, status: 'ATTENDED' }],
    }),
  })
  wrongDate.status === 409 && /does not run on that date/i.test(wrongDate.body?.error ?? '')
    ? ok('a date the recurrence does not cover is refused — no phantom sessions')
    : bad('uncovered date refused', `${wrongDate.status} ${JSON.stringify(wrongDate.body)}`)

  // ── One roll, correct routing ───────────────────────────────────────────
  console.log('\n\x1b[1mOne roll, correct routing\x1b[0m')

  const rollNow = (await tech(`/schedule/roll?eventId=${sharedId}&date=${tuesday}`)).body
  rollNow.people.length === roster.length && new Set(rollNow.people.map((p) => p.cohort)).size === 2
    ? ok(`one sheet lists both cohorts together (${rollNow.people.length} people, each carrying a cohort)`)
    : bad('one combined sheet', JSON.stringify(rollNow.people?.map((p) => p.cohort)))

  // Scoped to THIS event's two occurrences. Without that it also picks up the
  // seed's own marks for these stays on other events, and the assertion fails
  // for a reason that has nothing to do with routing.
  const routed = await runAsSystem(async () =>
    prisma.scheduleAttendance.findMany({
      where: {
        stayId: { in: roster.map((r) => r.stayId) },
        session: { occurrenceId: { in: [menOcc.id, womenOcc.id] } },
      },
      include: { session: { select: { occurrenceId: true } }, stay: { select: { cohort: true } } },
    }),
  )
  routed.length === roster.length &&
  routed.every((a) =>
    a.stay.cohort === 'MEN'
      ? a.session.occurrenceId === menOcc.id
      : a.session.occurrenceId === womenOcc.id,
  )
    ? ok('each mark landed on the session of its own cohort’s occurrence')
    : bad('mark routing', JSON.stringify(routed.map((a) => [a.stay.cohort, a.session.occurrenceId])))

  const stamps = await runAsSystem(async () =>
    prisma.scheduleSession.findMany({
      where: { occurrenceId: { in: [menOcc.id, womenOcc.id] } },
      select: { attendanceTakenAt: true },
    }),
  )
  stamps.length === 2 && stamps.every((s) => s.attendanceTakenAt)
    ? ok('one request stamped BOTH sessions — the roll is one fact about the event')
    : bad('both stamped', JSON.stringify(stamps))

  rollNow.attendanceTakenAt && rollNow.attendanceTakenBy?.fullName
    ? ok(`the roll records who took it (${rollNow.attendanceTakenBy.fullName}) and when`)
    : bad('taken-by recorded', JSON.stringify(rollNow.attendanceTakenBy))

  const marks = rollNow.people.filter((p) => p.status)
  marks.length === roster.length &&
  rollNow.people.find((p) => p.stayId === roster[0].stayId).status === 'ABSENT'
    ? ok('re-marking updates in place rather than duplicating the row')
    : bad('update in place', JSON.stringify(rollNow.people.map((p) => p.status)))

  // The wrong-cohort mark must be tested against a SINGLE-cohort event. Aiming
  // it at the shared one would pass for the wrong reason: a woman is legitimate
  // there. Same class of silent pass as the `>= 400` cohort assertion in
  // verify-residents.
  const wrongCohortMark = await tech('/schedule/attendance', {
    method: 'POST',
    body: JSON.stringify({
      eventId: once.body.id, date: onceDate,
      marks: [{ stayId: women[0].stayId, status: 'ATTENDED' }],
    }),
  })
  wrongCohortMark.status === 409
    ? ok('a mark for the other cohort on a MEN-only event is refused')
    : bad('cohort on marks', `${wrongCohortMark.status} ${JSON.stringify(wrongCohortMark.body)}`)

  const dupeMark = await tech('/schedule/attendance', {
    method: 'POST',
    body: JSON.stringify({
      eventId: sharedId, date: tuesday,
      marks: [
        { stayId: roster[0].stayId, status: 'ATTENDED' },
        { stayId: roster[0].stayId, status: 'ABSENT' },
      ],
    }),
  })
  dupeMark.status === 400
    ? ok('the same resident twice in one roll is refused')
    : bad('duplicate marks refused', dupeMark.status)

  // ── Unanimity ───────────────────────────────────────────────────────────
  console.log('\n\x1b[1mUnanimity\x1b[0m')

  // A past Tuesday inside the queue's 14-day lookback, stamped on ONE side only
  // via raw Prisma. This cannot be produced through the API — takeAttendance
  // always stamps every side — and it is the assertion that pins the rule.
  const pastTuesday = lastWeekdayOnOrBefore(addDays(today, -1), 2)
  await runAsSystem(async () =>
    prisma.scheduleSession.create({
      data: {
        occurrenceId: menOcc.id,
        cohort: 'MEN',
        sessionDate: new Date(`${pastTuesday}T00:00:00.000Z`),
        attendanceTakenAt: new Date(),
        attendanceTakenById: (await prisma.user.findFirst({ where: { email: 'tech@facility.test' } })).id,
      },
    }),
  )

  const halfBoard = (await tech(`/schedule?date=${pastTuesday}&days=1`)).body
  const halfTaken = sessionsOf(halfBoard.shared).find((s) => s.eventId === sharedId)
  halfTaken?.state === 'MISSED'
    ? ok('a shared session with only ONE side stamped is still MISSED — TAKEN needs unanimity')
    : bad('unanimity for TAKEN', halfTaken?.state)

  halfBoard.needsRoll.filter((s) => s.eventId === sharedId && s.date === pastTuesday).length === 1
    ? ok('and it sits in the queue exactly once, not once per cohort')
    : bad('queue lists once', halfBoard.needsRoll.filter((s) => s.eventId === sharedId).length)

  await tech('/schedule/attendance', {
    method: 'POST',
    body: JSON.stringify({
      eventId: sharedId, date: pastTuesday,
      marks: [{ stayId: roster[0].stayId, status: 'ATTENDED' }],
    }),
  })
  const cleared = (await tech(`/schedule?date=${pastTuesday}&days=1`)).body
  !cleared.needsRoll.some((s) => s.eventId === sharedId && s.date === pastTuesday)
    ? ok('one roll clears the queue item in a single action')
    : bad('queue clears', 'still listed after taking the roll')

  // ── Reschedule one date ─────────────────────────────────────────────────
  console.log('\n\x1b[1mReschedule\x1b[0m')

  // A week past `tuesday`, deliberately: the roll was taken on that one above,
  // and a taken session cannot be moved — its time is part of the record.
  const futureTue = addDays(tuesday, 7)

  const techMove = await tech('/schedule/reschedule', {
    method: 'POST',
    body: JSON.stringify({ eventId: sharedId, date: futureTue, startsAtLocal: '20:00' }),
  })
  techMove.status === 403
    ? ok('a tech cannot reschedule — setting the schedule is a decision, not an observation')
    : bad('tech reschedule refused', techMove.status)

  const moved = await manager('/schedule/reschedule', {
    method: 'POST',
    body: JSON.stringify({ eventId: sharedId, date: futureTue, startsAtLocal: '20:00' }),
  })
  moved.status === 200 && moved.body?.rescheduled === true
    ? ok('a manager moves one date')
    : bad('manager reschedules', `${moved.status} ${JSON.stringify(moved.body)}`)

  const overrides = await runAsSystem(async () =>
    prisma.scheduleSession.findMany({
      where: {
        occurrenceId: { in: [menOcc.id, womenOcc.id] },
        sessionDate: new Date(`${futureTue}T00:00:00.000Z`),
      },
      select: { occurrenceId: true, startsAtLocalOverride: true },
    }),
  )
  overrides.length === 2 && overrides.every((s) => s.startsAtLocalOverride === '20:00')
    ? ok('BOTH occurrences carry the override — the fan-out wrote every side')
    : bad('both sides moved', JSON.stringify(overrides))

  // THE assertion that catches a half-written fan-out. band.js refuses to merge
  // a pair whose times disagree, so moving one side splits the single shared
  // card into two lane cards — a wrong implementation fails visibly here rather
  // than passing quietly.
  const afterMove = (await tech(`/schedule?date=${futureTue}&days=1`)).body
  const stillShared = sessionsOf(afterMove.shared).find((s) => s.eventId === sharedId)
  const leakedToLane = afterMove.lanes.flatMap(sessionsOf).some((s) => s.eventId === sharedId)
  stillShared && !leakedToLane
    ? ok('the merged card survives the move — still shared, still in neither lane')
    : bad('merged card survives', `shared=${Boolean(stillShared)} inLane=${leakedToLane}`)

  stillShared?.startsAtLocal === '20:00' && stillShared?.rescheduled === true
    ? ok('the board reads the new time and flags it as moved')
    : bad('board reads override', JSON.stringify([stillShared?.startsAtLocal, stillShared?.rescheduled]))

  const nextTue = addDays(futureTue, 7)
  const untouched = sessionsOf((await tech(`/schedule?date=${nextTue}&days=1`)).body.shared).find(
    (s) => s.eventId === sharedId,
  )
  untouched && untouched.startsAtLocal === '19:00'
    ? ok('ONLY that date moved — the next one still reads the series rule')
    : bad('only one date', untouched?.startsAtLocal)

  const badTime = await manager('/schedule/reschedule', {
    method: 'POST',
    body: JSON.stringify({ eventId: sharedId, date: futureTue, startsAtLocal: '25:00' }),
  })
  badTime.status === 400
    ? ok('a malformed wall clock is refused at the boundary')
    : bad('bad time refused', badTime.status)

  const uncovered = await manager('/schedule/reschedule', {
    method: 'POST',
    body: JSON.stringify({ eventId: sharedId, date: addDays(futureTue, 1), startsAtLocal: '20:00' }),
  })
  uncovered.status === 409 && /does not run on that date/i.test(uncovered.body?.error ?? '')
    ? ok('a date the recurrence does not cover is refused')
    : bad('uncovered date refused', `${uncovered.status} ${JSON.stringify(uncovered.body)}`)

  const pastMove = await manager('/schedule/reschedule', {
    method: 'POST',
    body: JSON.stringify({ eventId: sharedId, date: tuesday, startsAtLocal: '20:00' }),
  })
  pastMove.status === 409
    ? ok(`a past or already-rolled session is refused — "${pastMove.body?.error}"`)
    : bad('past refused', `${pastMove.status} ${JSON.stringify(pastMove.body)}`)

  // Cancelling has no route yet, so set it directly to exercise the guard.
  const cancelTue = addDays(futureTue, 14)
  await runAsSystem(async () => {
    const techUser = await prisma.user.findFirst({ where: { email: 'tech@facility.test' } })
    for (const occurrenceId of [menOcc.id, womenOcc.id]) {
      await prisma.scheduleSession.create({
        data: {
          occurrenceId,
          cohort: occurrenceId === menOcc.id ? 'MEN' : 'WOMEN',
          sessionDate: new Date(`${cancelTue}T00:00:00.000Z`),
          cancelledAt: new Date(),
          cancelledById: techUser.id,
          cancelReason: 'Hall unavailable.',
        },
      })
    }
  })
  const cancelledMove = await manager('/schedule/reschedule', {
    method: 'POST',
    body: JSON.stringify({ eventId: sharedId, date: cancelTue, startsAtLocal: '20:00' }),
  })
  cancelledMove.status === 409 && /cancelled/i.test(cancelledMove.body?.error ?? '')
    ? ok('a cancelled session has no time to move')
    : bad('cancelled refused', `${cancelledMove.status} ${JSON.stringify(cancelledMove.body)}`)

  const clearedMove = await manager('/schedule/reschedule', {
    method: 'POST',
    body: JSON.stringify({ eventId: sharedId, date: futureTue, startsAtLocal: null }),
  })
  const afterClear = sessionsOf((await tech(`/schedule?date=${futureTue}&days=1`)).body.shared).find(
    (s) => s.eventId === sharedId,
  )
  clearedMove.status === 200 && afterClear?.startsAtLocal === '19:00' && !afterClear.rescheduled
    ? ok('null clears the override and the date returns to the series rule')
    : bad('clear override', JSON.stringify([clearedMove.status, afterClear?.startsAtLocal]))

  // ── Roster lifecycle ────────────────────────────────────────────────────
  console.log('\n\x1b[1mRoster lifecycle\x1b[0m')

  const sharedRosterOn = (b) =>
    sessionsOf(b.shared).find((s) => s.eventId === sharedId)?.rosterCount
  const before = sharedRosterOn((await tech(`/schedule?date=${today}&days=14`)).body)

  const victim = roster[1]
  await manager(`/residents/${victim.residentId}/discharge`, {
    method: 'POST',
    body: JSON.stringify({ dischargeType: 'SUCCESSFUL', dischargeReason: 'Completed the program.' }),
  })

  const after = sharedRosterOn((await tech(`/schedule?date=${today}&days=14`)).body)
  after === before - 1
    ? ok(`a discharge drops them off future sessions with NO write to the schedule (${before} → ${after})`)
    : bad('discharge drops off roster', `${before} → ${after}`)

  const rollAfter = (await tech(`/schedule/roll?eventId=${sharedId}&date=${tuesday}`)).body
  rollAfter.people.some((p) => p.stayId === victim.stayId && p.status)
    ? ok('their past mark survives — the mark names the stay, not the roster row')
    : bad('mark survives', JSON.stringify(rollAfter.people.map((p) => [p.fullName, p.status])))

  // ── Deletion ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mDeletion\x1b[0m')

  const delMarked = await manager(`/schedule/events/${sharedId}`, { method: 'DELETE' })
  delMarked.status === 409 && /end the series/i.test(delMarked.body?.error ?? '')
    ? ok(`an event with attendance recorded cannot be deleted — "${delMarked.body.error}"`)
    : bad('marked event delete refused', `${delMarked.status} ${JSON.stringify(delMarked.body)}`)

  const delClean = await manager(`/schedule/events/${future.body.id}`, { method: 'DELETE' })
  delClean.status === 204
    ? ok('an event with no attendance yet deletes freely — the "created it wrong" case')
    : bad('clean event deletes', delClean.status)

  const techDelete = await tech(`/schedule/events/${ended.body.id}`, { method: 'DELETE' })
  techDelete.status === 403
    ? ok('a tech cannot delete an event')
    : bad('tech delete refused', techDelete.status)

  // ── Editing ─────────────────────────────────────────────────────────────
  // `sharedId` is frozen twice over by now: it has attendance from the roll
  // group and cancelled sessions from the reschedule group.
  console.log('\n\x1b[1mEditing\x1b[0m')

  const techPatch = await tech(`/schedule/events/${sharedId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Tech was here' }),
  })
  techPatch.status === 403
    ? ok('a tech cannot edit an event')
    : bad('tech patch refused', techPatch.status)

  // Identity is free even on a frozen event: renaming a group neither moves a
  // session nor invalidates a mark.
  const renamed = await manager(`/schedule/events/${sharedId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Verify — Renamed Group', location: 'Back room' }),
  })
  const stillTaken = (await tech(`/schedule/roll?eventId=${sharedId}&date=${tuesday}`)).body
  renamed.status === 200 &&
  renamed.body.title === 'Verify — Renamed Group' &&
  renamed.body.location === 'Back room' &&
  stillTaken.attendanceTakenAt
    ? ok('title and location change on an event WITH attendance — and the taken roll is untouched')
    : bad('identity editable', `${renamed.status} ${JSON.stringify(renamed.body?.error)}`)

  renamed.body?.recorded?.frozen === true && renamed.body.recorded.marked > 0
    ? ok(`getEvent reports the recorded history (${recordedSummary(renamed.body.recorded)})`)
    : bad('recorded reported', JSON.stringify(renamed.body?.recorded))

  // Shape is frozen. This is the assertion the whole design rests on: changing
  // the weekdays would make every past Tuesday stop being emitted by expand().
  for (const [label, patch] of [
    ['weekdays', { weekdays: [4] }],
    ['the start time', { startsAtLocal: '20:00' }],
    ['the duration', { durationMinutes: 45 }],
    ['the first date', { startsOn: '2026-06-02' }],
    ['the cohorts', { cohorts: ['MEN'] }],
  ]) {
    const r = await manager(`/schedule/events/${sharedId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    r.status === 409 && /move the series/i.test(r.body?.error ?? '')
      ? ok(`${label} cannot change once anything is recorded`)
      : bad(`${label} frozen`, `${r.status} ${JSON.stringify(r.body)}`)
  }

  // endsOn is the SANCTIONED edit and orphans history by the same gate, so it
  // gets the same care.
  const lastRecorded = renamed.body.recorded.lastRecordedDate
  const tooEarly = await manager(`/schedule/events/${sharedId}`, {
    method: 'PATCH',
    body: JSON.stringify({ endsOn: addDays(lastRecorded, -1) }),
  })
  tooEarly.status === 409 && /every screen/i.test(tooEarly.body?.error ?? '')
    ? ok('endsOn cannot be set before the last recorded date — that would orphan it')
    : bad('endsOn floor', `${tooEarly.status} ${JSON.stringify(tooEarly.body)}`)

  const endedOk = await manager(`/schedule/events/${sharedId}`, {
    method: 'PATCH',
    body: JSON.stringify({ endsOn: addDays(lastRecorded, 30) }),
  })
  const afterEnd = (await tech(`/schedule?date=${tuesday}&days=1`)).body
  const takenStillThere = everySession(afterEnd).find((s) => s.eventId === sharedId)
  endedOk.status === 200 && takenStillThere?.state === 'TAKEN'
    ? ok('ending a series leaves the already-taken session on the board')
    : bad('end keeps history', `${endedOk.status} ${takenStillThere?.state}`)

  // The roster is free even while frozen — the point of hanging marks off the
  // session rather than off the roster row.
  //
  // Candidates are re-read here, not reused from the top of the file: the roster
  // lifecycle group above DISCHARGED somebody, and `cohortsOfStays` refuses a
  // closed stay. Building this fixture from the stale list tests the discharge
  // guard by accident instead of the thing it is here for.
  const liveMen = (await manager('/schedule/candidates?cohort=MEN')).body.residents
  const liveWomen = (await manager('/schedule/candidates?cohort=WOMEN')).body.residents.filter(
    (w) => w.fullName !== 'Joy Nakamura',
  )
  const onRoster = renamed.body.attendees.map((a) => a.stayId)
  const dropped = liveMen.find((m) => onRoster.includes(m.stayId)).stayId
  const keptRoster = [...liveMen, ...liveWomen]
    .map((r) => r.stayId)
    .filter((id) => id !== dropped && onRoster.includes(id))
  const rosterPatch = await manager(`/schedule/events/${sharedId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stayIds: keptRoster }),
  })
  const rollPostDrop = (await tech(`/schedule/roll?eventId=${sharedId}&date=${tuesday}`)).body
  const droppedMark = rollPostDrop.people.find((p) => p.stayId === dropped)
  rosterPatch.status === 200 &&
  rosterPatch.body.attendees.length === keptRoster.length &&
  droppedMark?.offRoster === true &&
  droppedMark?.status
    ? ok('a resident comes off the roster while frozen — and their past mark survives as offRoster')
    : bad(
        'roster editable',
        `${rosterPatch.status}, ${rosterPatch.body?.attendees?.length} attendees vs ${keptRoster.length} sent, ` +
          `offRoster=${droppedMark?.offRoster} status=${droppedMark?.status}`,
      )

  const backOn = await manager(`/schedule/events/${sharedId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stayIds: [dropped, ...keptRoster] }),
  })
  backOn.status === 200 && backOn.body.attendees.some((a) => a.stayId === dropped)
    ? ok('and they can be added back — the live-attendee index is partial')
    : bad('re-add', `${backOn.status} ${backOn.body?.error}`)

  const wrongCohort = await manager(`/schedule/events/${sharedId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stayIds: [...keptRoster, dropped], cohorts: ['MEN'] }),
  })
  wrongCohort.status === 409
    ? ok('a roster edit cannot smuggle a cohort change past the freeze')
    : bad('cohort via roster', `${wrongCohort.status}`)

  // ── Editing an unfrozen event ───────────────────────────────────────────
  console.log('\n\x1b[1mEditing an unfrozen event\x1b[0m')

  const freshBody = {
    ...sharedBody,
    title: 'Verify — Fresh Group',
    startsOn: addDays(today, 7),
    // Live residents only, for the same reason as above.
    stayIds: [...liveMen, ...liveWomen].map((r) => r.stayId),
  }
  const fresh = await manager('/schedule/events', { method: 'POST', body: JSON.stringify(freshBody) })
  const freshId = fresh.body.id

  const shapeOk = await manager(`/schedule/events/${freshId}`, {
    method: 'PATCH',
    body: JSON.stringify({ startsAtLocal: '17:15', durationMinutes: 45, weekdays: [4] }),
  })
  const freshOccs = await runAsSystem(async () =>
    prisma.scheduleOccurrence.findMany({ where: { eventId: freshId }, orderBy: { cohort: 'asc' } }),
  )
  const bothMoved =
    freshOccs.length === 2 &&
    new Set(freshOccs.map((o) => `${o.startsAtLocal}|${o.durationMinutes}|${o.weekdays.join(',')}`)).size === 1 &&
    freshOccs[0].startsAtLocal === '17:15'
  shapeOk.status === 200 && bothMoved
    ? ok('shape changes freely with nothing recorded, and lands on BOTH occurrences identically')
    : bad('shape editable', `${shapeOk.status} ${JSON.stringify(freshOccs.map((o) => o.startsAtLocal))}`)

  // The one that catches a half-written fan-out: band.js refuses to merge a
  // divergent pair, so a shared card would split into two lane cards.
  // The first Thursday ON OR AFTER the fresh event's startsOn — not simply the
  // next one, which may fall before the series begins and would make occursOn
  // false for a reason that has nothing to do with the edit under test.
  const nextThu = (() => {
    let d = freshBody.startsOn
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 4) d = addDays(d, 1)
    return d
  })()
  const freshBoard = (await tech(`/schedule?date=${nextThu}&days=1`)).body
  const freshShared = sessionsOf(freshBoard.shared).filter((s) => s.eventId === freshId)
  const freshLanes = freshBoard.lanes.flatMap(sessionsOf).filter((s) => s.eventId === freshId)
  freshShared.length === 1 && freshLanes.length === 0 && freshShared[0].startsAtLocal === '17:15'
    ? ok('the merged shared card SURVIVES the timing edit — one card, in neither lane')
    : bad('merged survives', `shared ${freshShared.length}, lanes ${freshLanes.length}`)

  const toOnce = await manager(`/schedule/events/${freshId}`, {
    method: 'PATCH',
    body: JSON.stringify({ recurrence: 'ONCE', weekdays: [] }),
  })
  const onceOccs = await runAsSystem(async () =>
    prisma.scheduleOccurrence.findMany({ where: { eventId: freshId } }),
  )
  toOnce.status === 200 && onceOccs.every((o) => o.weekdays.length === 0 && +o.endsOn === +o.startsOn)
    ? ok('switching to ONCE clears the weekdays and closes the window on its own day')
    : bad('to once', `${toOnce.status} ${JSON.stringify(onceOccs.map((o) => o.weekdays))}`)

  const empty = await manager(`/schedule/events/${freshId}`, { method: 'PATCH', body: '{}' })
  empty.status === 400
    ? ok('an empty patch is refused rather than silently doing nothing')
    : bad('empty patch', empty.status)

  // ── Moving a series ─────────────────────────────────────────────────────
  console.log('\n\x1b[1mMoving a series\x1b[0m')

  const techMoveSeries = await tech(`/schedule/events/${sharedId}/move`, {
    method: 'POST',
    body: JSON.stringify({ from: addDays(today, 21), weekdays: [4] }),
  })
  techMoveSeries.status === 403
    ? ok('a tech cannot move a series')
    : bad('tech move refused', techMoveSeries.status)

  const unfrozenMove = await manager(`/schedule/events/${freshId}/move`, {
    method: 'POST',
    body: JSON.stringify({ from: addDays(today, 21), weekdays: [4] }),
  })
  unfrozenMove.status === 409 && /edit it directly/i.test(unfrozenMove.body?.error ?? '')
    ? ok('an event with nothing recorded is edited, not moved')
    : bad('unfrozen move refused', `${unfrozenMove.status} ${JSON.stringify(unfrozenMove.body)}`)

  const backwardsMove = await manager(`/schedule/events/${sharedId}/move`, {
    method: 'POST',
    body: JSON.stringify({ from: lastRecorded, weekdays: [4] }),
  })
  backwardsMove.status === 409 && /already accounted for/i.test(backwardsMove.body?.error ?? '')
    ? ok('a move cannot start on or before a date already on the record')
    : bad('backwards move refused', `${backwardsMove.status} ${JSON.stringify(backwardsMove.body)}`)

  const takenBefore = (await tech(`/schedule/roll?eventId=${sharedId}&date=${tuesday}`)).body
  const moveFrom = addDays(lastRecorded, 21)
  const seriesMove = await manager(`/schedule/events/${sharedId}/move`, {
    method: 'POST',
    body: JSON.stringify({
      from: moveFrom,
      weekdays: [4],
      startsAtLocal: '18:30',
      reason: 'Room reassigned by the treatment team.',
    }),
  })
  seriesMove.status === 201 && seriesMove.body?.event?.id && seriesMove.body?.previous?.id === sharedId
    ? ok('a manager moves the series — it returns both halves')
    : bad('move succeeds', `${seriesMove.status} ${JSON.stringify(seriesMove.body?.error)}`)

  const successorId = seriesMove.body.event.id
  seriesMove.body.event.supersedesId === sharedId && seriesMove.body.event.moveReason
    ? ok('the new series records what it supersedes, and why')
    : bad('provenance', JSON.stringify({ s: seriesMove.body.event.supersedesId, r: seriesMove.body.event.moveReason }))

  seriesMove.body.previous.endsOn === addDays(moveFrom, -1)
    ? ok(`the old series closes the day before the new one opens (${seriesMove.body.previous.endsOn})`)
    : bad('old ended', seriesMove.body.previous.endsOn)

  seriesMove.body.event.startsOn === moveFrom &&
  seriesMove.body.event.weekdays.join(',') === '4' &&
  seriesMove.body.event.startsAtLocal === '18:30'
    ? ok('the new series starts on the move date with the new shape')
    : bad('new shape', JSON.stringify(seriesMove.body.event))

  // Carried, but filtered to ACTIVE stays. The old roster still holds whoever was
  // discharged mid-series — that is how their marks keep their context — and they
  // are not on next month's group.
  const stillHere = new Set([...liveMen, ...liveWomen].map((r) => r.stayId))
  const previousActive = seriesMove.body.previous.attendees.filter((a) => stillHere.has(a.stayId))
  const carriedRight =
    seriesMove.body.event.attendees.length === previousActive.length &&
    seriesMove.body.event.attendees.length > 0 &&
    seriesMove.body.event.attendees.every((a) => stillHere.has(a.stayId))
  carriedRight
    ? ok(`the roster carries over (${seriesMove.body.event.attendees.length} active residents), not retyped`)
    : bad(
        'roster copied',
        `${seriesMove.body.event.attendees.length} carried vs ${previousActive.length} active`,
      )

  const dischargedCarried = seriesMove.body.previous.attendees.length > previousActive.length
  dischargedCarried
    ? ok('a resident discharged mid-series stays on the OLD roster and is not carried forward')
    : ok('no discharged resident on this roster to exclude (nothing to prove here)')

  // THE POINT OF ALL OF THIS.
  const takenAfter = (await tech(`/schedule/roll?eventId=${sharedId}&date=${tuesday}`)).body
  const boardAfter = (await tech(`/schedule?date=${tuesday}&days=1`)).body
  const onBoard = everySession(boardAfter).find((s) => s.eventId === sharedId)
  takenAfter.attendanceTakenAt === takenBefore.attendanceTakenAt &&
  takenAfter.people.length === takenBefore.people.length &&
  onBoard?.state === 'TAKEN'
    ? ok('every previously-taken session is STILL reachable and still reads TAKEN after the move')
    : bad('history preserved', `roll ${takenAfter.attendanceTakenAt}, board ${onBoard?.state}`)

  const secondMove = await manager(`/schedule/events/${sharedId}/move`, {
    method: 'POST',
    body: JSON.stringify({ from: addDays(moveFrom, 7), weekdays: [5] }),
  })
  secondMove.status >= 400
    ? ok('an event cannot be moved twice — one live successor, so the chain cannot fork')
    : bad('fork refused', secondMove.status)

  // ── Deleting a cancelled-only event ─────────────────────────────────────
  // The widened guard. This used to delete freely and orphan its session rows,
  // which can be neither soft-deleted nor hard-deleted.
  console.log('\n\x1b[1mDeletion — cancelled but unmarked\x1b[0m')

  const cancelOnly = await manager('/schedule/events', {
    method: 'POST',
    body: JSON.stringify({ ...sharedBody, title: 'Verify — Cancelled Only', cohorts: ['MEN'], stayIds: [] }),
  })
  const cancelOnlyOcc = cancelOnly.body.occurrences[0]
  await runAsSystem(async () => {
    const techUser = await prisma.user.findFirst({ where: { email: 'tech@facility.test' } })
    await prisma.scheduleSession.create({
      data: {
        occurrenceId: cancelOnlyOcc.id,
        cohort: 'MEN',
        sessionDate: new Date(`${addDays(today, 14)}T00:00:00.000Z`),
        cancelledAt: new Date(),
        cancelledById: techUser.id,
        cancelReason: 'Hall unavailable.',
      },
    })
  })
  const delCancelled = await manager(`/schedule/events/${cancelOnly.body.id}`, { method: 'DELETE' })
  delCancelled.status === 409 && /cancelled/i.test(delCancelled.body?.error ?? '')
    ? ok(`a cancelled session is history too — delete refused ("${delCancelled.body.error}")`)
    : bad('cancelled-only delete refused', `${delCancelled.status} ${JSON.stringify(delCancelled.body)}`)

  const patchCancelled = await manager(`/schedule/events/${cancelOnly.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ weekdays: [4] }),
  })
  patchCancelled.status === 409
    ? ok('and its shape is frozen by the same predicate, so edit and delete agree')
    : bad('cancelled-only shape frozen', patchCancelled.status)

  // ── The resident record ─────────────────────────────────────────────────
  console.log('\n\x1b[1mThe resident record\x1b[0m')

  const mine = (await tech(`/residents/${men[0].residentId}/attendance`)).body

  // The DIARY IS GONE (2026-08-08). This endpoint answers what happened, and
  // /schedule answers what is coming — so nothing upcoming may ride along. A
  // key-presence check rather than a length check: a re-added `upcoming: []`
  // would pass the second and quietly restore the coupling.
  !('upcoming' in mine)
    ? ok('the record carries no upcoming sessions — the diary moved out, it did not empty')
    : bad('upcoming gone', JSON.stringify(Object.keys(mine)))

  // Ordered by the SESSION's date, not by when the mark was typed. The section
  // presents it as chronological — a summary, a "since" date, a run of marks all
  // read it as a sequence — and `createdAt desc` is a different sequence the
  // moment anybody back-fills a roll.
  const markDates = mine.marks.map((a) => a.date)
  const descending = [...markDates].sort().reverse()
  JSON.stringify(markDates) === JSON.stringify(descending)
    ? ok(`attendance comes back newest-session-first (${markDates.join(', ') || 'empty'})`)
    : bad('marks ordered by session date', JSON.stringify(markDates))

  // The section distinguishes "no active stay" from "nothing recorded", and it
  // can only do that because the payload says which.
  mine.hasActiveStay === true
    ? ok('an active resident says so, so the section can tell the empty states apart')
    : bad('hasActiveStay', mine.hasActiveStay)

  // ── The summary counts the STAY, not the page ───────────────────────────
  // The easiest bug to ship in this reshape: attendanceSummary() used to count
  // the ten rows it had been sent, which was true while ten was all there was.
  // Against a paginated history the same arithmetic describes page one while the
  // heading claims to describe the stay — a figure that shrinks as you scroll.
  const paged = (await tech(`/residents/${men[0].residentId}/attendance?limit=1`)).body
  paged.marks.length === 1 && paged.summary
    ? ok('page one carries the summary alongside a single mark')
    : bad('summary on page one', `${paged.marks.length} marks, summary ${Boolean(paged.summary)}`)

  paged.summary && paged.summary.total > paged.marks.length
    ? ok(`the summary counts the whole stay, not the page (${paged.summary.total} vs ${paged.marks.length} loaded)`)
    : bad('summary counts stay', JSON.stringify(paged.summary))

  // ── Keyset pages ────────────────────────────────────────────────────────
  if (paged.nextCursor) {
    const second = (await tech(
      `/residents/${men[0].residentId}/attendance?limit=1&cursor=${encodeURIComponent(paged.nextCursor)}`,
    )).body
    const overlap = second.marks.some((m) => paged.marks.some((p) => p.id === m.id))
    !overlap
      ? ok('a second keyset page does not repeat the first')
      : bad('page overlap', JSON.stringify(second.marks.map((m) => m.id)))
    second.marks.every((m) => m.date <= paged.marks[paged.marks.length - 1].date)
      ? ok('…and does not break the newest-first ordering across the boundary')
      : bad('page ordering', `${second.marks[0]?.date} after ${paged.marks.at(-1)?.date}`)
    // The aggregate rides on page one only, so a Load-more does not re-run it.
    second.summary === null
      ? ok('…and a cursor page omits the summary rather than recomputing it')
      : bad('summary on page two', JSON.stringify(second.summary))
  }

  const badCursor = await tech(`/residents/${men[0].residentId}/attendance?cursor=not-a-cursor`)
  badCursor.status === 400
    ? ok('a malformed cursor is a 400')
    : bad('bad cursor', badCursor.status)

  const roster2 = (await tech('/residents')).body.residents
  const joy = roster2.find((r) => r.lastName === 'Nakamura')
  const joyAtt = (await tech(`/residents/${joy.id}/attendance`)).body
  joyAtt.marks.length === 0 && joyAtt.hasActiveStay === true && joyAtt.summary === null
    ? ok('a resident with no marks gets an empty record and NO summary — a 0-of-0 bar is not shown')
    : bad('empty attendance', JSON.stringify({ n: joyAtt.marks.length, a: joyAtt.hasActiveStay }))

  // `victim` was discharged by the roster-lifecycle group above.
  const goneAtt = (await tech(`/residents/${victim.residentId}/attendance`)).body
  goneAtt.hasActiveStay === false && goneAtt.marks.length === 0
    ? ok('a DISCHARGED resident reports hasActiveStay:false — a different empty state')
    : bad('discharged attendance', JSON.stringify({ a: goneAtt.hasActiveStay, n: goneAtt.marks?.length }))

  const audited = await runAsSystem(async () =>
    prisma.auditLog.count({ where: { entity: { in: ['ScheduleAttendance', 'ScheduleAttendee'] } } }),
  )
  audited > 0
    ? ok(`schedule reads and writes are audited (${audited} rows)`)
    : bad('audited', audited)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
