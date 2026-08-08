/**
 * Med pass — observed self-administration, and the guards that make a dose
 * usable as evidence.
 *
 * What this proves: doses are EXPANDED from wall-clock times with nothing
 * materialized; the two-hour grace decides DUE from MISSED and is proved on
 * fixed instants either side of it; an 8pm dose is 8pm on both sides of a DST
 * boundary; MISSED is not storable at all; a dose not given needs a reason, in
 * the route AND the database, including the NULL case a CHECK passes on; a
 * dose can be answered once and corrected only by amendment; the amendment is
 * a pure INSERT that cannot fork, cannot cross medications, and leaves the
 * original readable; both layers of append-only are asserted separately; a
 * medication with doses cannot be deleted, only ended, and never before its
 * last recorded dose; a discharge drops future doses with no write; the bell
 * carries a count and NEVER a name or a medication; RLS scopes doses to the
 * resident's own stay; and the audit trail carries ids only.
 *
 * Run after `node scripts/seed.js`. Posts doses and medications and does not
 * clean up, so reseed afterwards.
 */
import { createApp } from '../src/app.js'
import { prisma } from '../src/db/client.js'
import { ACTOR, runAsSystem, runWithDbActor } from '../src/lib/dbContext.js'
import { MED_PASS_GRACE_MS } from '../src/domain/constants.js'
import { doseStateOf, medMissedCutoff } from '../src/services/meds.js'
import { facilityWallClockToUtc } from '../src/lib/facilityTime.js'

let pass = 0
let fail = 0
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++ }
const bad = (n, d) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`); fail++ }
const PW = 'soberlife-dev-1234'

/** Every guard below should REJECT. A pass here means the write did not land. */
async function rejects(label, fn) {
  try {
    await fn()
    bad(label, 'the write was allowed')
  } catch {
    ok(label)
  }
}

const MIN = 60_000

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

  const tech = as(await login('tech@facility.test'))
  const manager = as(await login('manager@facility.test'))

  // The owner connection, for what only a superuser can prove: that the
  // triggers and CHECKs hold against direct SQL. Raw SQL through the app
  // client cannot stand in — with no actor context RLS fail-closes, the
  // statement matches zero rows, and that looks like a pass while testing
  // nothing.
  const pg = (await import('pg')).default
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await owner.connect()

  const techUser = await runAsSystem(async () =>
    prisma.user.findUnique({ where: { email: 'tech@facility.test' }, select: { id: true } }),
  )

  // ── The grace, with no database at all ───────────────────────────────────
  // Fixed instants, so no DST week and no time of day can flake these. Both
  // directions, because a regression to "everything past its time is missed"
  // still passes the missed half.
  console.log('\n\x1b[1mThe grace is two hours, proved on fixed instants\x1b[0m')

  const now = new Date('2026-08-07T18:00:00Z')
  const at = (msAgo) => new Date(now.getTime() - msAgo)

  doseStateOf(at(119 * MIN), null, now) === 'DUE'
    ? ok('a dose 119 minutes past its time is still DUE')
    : bad('119m DUE', doseStateOf(at(119 * MIN), null, now))
  doseStateOf(at(121 * MIN), null, now) === 'MISSED'
    ? ok('a dose 121 minutes past its time is MISSED')
    : bad('121m MISSED', doseStateOf(at(121 * MIN), null, now))
  doseStateOf(at(-30 * MIN), null, now) === 'UPCOMING'
    ? ok('a dose half an hour from now is UPCOMING, not due')
    : bad('future UPCOMING', doseStateOf(at(-30 * MIN), null, now))
  MED_PASS_GRACE_MS === 2 * 60 * 60_000
    ? ok('MED_PASS_GRACE_MS is the two hours the facility chose')
    : bad('grace knob', MED_PASS_GRACE_MS)
  now.getTime() - medMissedCutoff(now).getTime() === MED_PASS_GRACE_MS
    ? ok('medMissedCutoff is exactly one grace window back — the one knob')
    : bad('cutoff', medMissedCutoff(now))

  // A recorded observation always wins over the clock. Without this a dose
  // given late would flip back to MISSED the moment the page refreshed.
  doseStateOf(at(300 * MIN), { status: 'GIVEN' }, now) === 'GIVEN'
    ? ok('a log beats the clock: a late-recorded dose stays GIVEN')
    : bad('log wins', doseStateOf(at(300 * MIN), { status: 'GIVEN' }, now))

  // ── A wall clock survives DST ────────────────────────────────────────────
  // The reason times are 'HH:MM' strings converted per date rather than
  // instants. Stored as an instant, the November dose drifts an hour.
  console.log('\n\x1b[1mAn 8pm dose is 8pm on both sides of a DST boundary\x1b[0m')

  const beforeDst = facilityWallClockToUtc('2026-10-15', '20:00')
  const afterDst = facilityWallClockToUtc('2026-11-15', '20:00')
  const wall = (d) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.FACILITY_TIMEZONE ?? 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d)
  wall(beforeDst) === '20:00' && wall(afterDst) === '20:00'
    ? ok('20:00 reads 20:00 in both October and November')
    : bad('dst', `${wall(beforeDst)} / ${wall(afterDst)}`)
  beforeDst.getUTCHours() !== afterDst.getUTCHours()
    ? ok('…and the two are DIFFERENT UTC instants, so the offset really moved')
    : bad('dst utc', 'both instants share a UTC hour — the conversion is a no-op')

  // ── The gate ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe gate\x1b[0m')

  const anon = as('')
  ;(await anon('/meds')).status === 401
    ? ok('an anonymous request cannot read the board')
    : bad('anon', (await anon('/meds')).status)

  const board = await tech('/meds')
  board.status === 200
    ? ok('a tech CAN read the board — running a pass is a hallway act')
    : bad('tech board', board.status)

  // Captured HERE, before anything is recorded. The bell item is derived, so
  // the recording section below clears it — asserting its shape afterwards
  // would silently skip every assertion about it.
  const bellWhileDue = await tech('/notifications')
  const medItem = bellWhileDue.body.items.find((i) => i.kind === 'MED_PASS_DUE')

  // ── The board carries no medication ──────────────────────────────────────
  // The privacy boundary this module rests on, asserted against the SERIALISED
  // payload rather than a list of known keys — so a `medicationName` somebody
  // adds to a pass row later fails this rather than sliding past it.
  console.log('\n\x1b[1mThe board names residents but never medications\x1b[0m')

  const boardText = JSON.stringify(board.body)
  const seededDrugs = /Sertraline|Lisinopril|Metformin|Bupropion|Ibuprofen|Trazodone/
  !seededDrugs.test(boardText)
    ? ok('no medication name appears anywhere in the board payload')
    : bad('board leak', boardText.match(seededDrugs)?.[0])
  const detailFields = /dosage|instructions|prescriber|pharmacy/
  !detailFields.test(boardText)
    ? ok('no dosage, prescriber or pharmacy either')
    : bad('board leak 2', 'a medication detail field is on the wire')
  board.body.passes.some((p) => p.residents.some((r) => r.fullName))
    ? ok('resident names ARE on the board — it is a work queue, like /service')
    : bad('board names', 'nobody is named, so nobody can run the pass')

  // ── The sheet is the deliberate open ─────────────────────────────────────
  console.log('\n\x1b[1mThe sheet names the medications\x1b[0m')

  const withDue = board.body.passes.find((p) => p.due > 0)
  const target = withDue?.residents.find((r) => r.due > 0)
  if (!target) {
    // Report and STOP, rather than dereferencing undefined two lines down. The
    // seed anchors a due dose to the current hour at every hour of the day, so
    // reaching this means the fixture is genuinely wrong — and a TypeError
    // stack would say nothing about which.
    bad('fixture', 'the seed produced no due dose — reseed and re-run')
    console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
    await owner.end()
    server.close()
    process.exit(1)
  }
  const sheet = await tech(`/meds/pass/${target.stayId}`)
  sheet.status === 200 && sheet.body.doses.some((d) => d.medicationName)
    ? ok('one resident’s sheet DOES name their medications')
    : bad('sheet', sheet.status)
  sheet.body.doses.every((d) => d.scheduledFor)
    ? ok('every dose on the sheet carries the slot it answers')
    : bad('sheet slots', 'a dose has no scheduledFor')

  // ── Recording ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mRecording a pass\x1b[0m')

  const dueDose = sheet.body.doses.find((d) => d.state === 'DUE')
  const upcoming = sheet.body.doses.find((d) => d.state === 'UPCOMING')

  const post = (body) => tech('/meds/logs', { method: 'POST', body: JSON.stringify(body) })

  // A dose whose time has not come is an observation nobody has made — the
  // same reasoning as ApartmentCheck.checkedAt always being the server clock.
  if (upcoming) {
    const early = await post({
      stayId: target.stayId,
      observedById: techUser.id,
      entries: [{ medicationId: upcoming.medicationId, time: upcoming.time, status: 'GIVEN' }],
    })
    early.status === 409
      ? ok('a dose that is not due yet cannot be recorded')
      : bad('early dose', early.status)
  }

  const noReason = await post({
    stayId: target.stayId,
    observedById: techUser.id,
    entries: [{ medicationId: dueDose.medicationId, time: dueDose.time, status: 'REFUSED' }],
  })
  noReason.status === 400
    ? ok('a refused dose with no reason is refused at the route')
    : bad('no reason', noReason.status)

  const good = await post({
    stayId: target.stayId,
    observedById: techUser.id,
    entries: [{ medicationId: dueDose.medicationId, time: dueDose.time, status: 'GIVEN' }],
  })
  good.status === 201 ? ok('a tech can record a due dose') : bad('record', good.status)

  const twice = await post({
    stayId: target.stayId,
    observedById: techUser.id,
    entries: [{ medicationId: dueDose.medicationId, time: dueDose.time, status: 'GIVEN' }],
  })
  twice.status === 409
    ? ok('the same dose cannot be recorded twice')
    : bad('duplicate', twice.status)

  const badObserver = await post({
    stayId: target.stayId,
    observedById: 'nobody',
    entries: [{ medicationId: dueDose.medicationId, time: dueDose.time, status: 'GIVEN' }],
  })
  badObserver.status === 400
    ? ok('an unknown observing staff member is refused')
    : bad('observer', badObserver.status)

  // MISSED must not be typeable. Its absence from the enum is the design, and
  // this is the assertion that stops somebody widening it back.
  const missedStatus = await post({
    stayId: target.stayId,
    observedById: techUser.id,
    entries: [{ medicationId: dueDose.medicationId, time: dueDose.time, status: 'MISSED' }],
  })
  missedStatus.status === 400
    ? ok('MISSED is not a recordable status — it is the absence of a record')
    : bad('missed storable', missedStatus.status)

  const enumValues = await owner.query(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'MedLogStatus'`,
  )
  enumValues.rows.length === 3
    ? ok('…and the database enum carries exactly three members')
    : bad('enum width', enumValues.rows.map((r) => r.enumlabel).join(','))

  // The board must now agree with what was just written — one derivation, so
  // it cannot disagree with itself.
  const after = await tech('/meds')
  after.body.figures.marked === board.body.figures.marked + 1
    ? ok('the board’s marked count moves by exactly one')
    : bad('board moved', `${board.body.figures.marked} → ${after.body.figures.marked}`)
  after.body.figures.due === board.body.figures.due - 1
    ? ok('…and its due count drops by exactly one')
    : bad('due moved', `${board.body.figures.due} → ${after.body.figures.due}`)

  // ── The database's own guards ────────────────────────────────────────────
  console.log('\n\x1b[1mThe note requirement, at the database\x1b[0m')

  const seedLog = await runAsSystem(async () =>
    prisma.medLog.findFirst({ where: { status: 'GIVEN' }, orderBy: { createdAt: 'desc' } }),
  )

  const rawInsert = (cols, vals) =>
    owner.query(
      `INSERT INTO "med_logs" ("id","medicationId","stayId","status","observedById","recordedById","medicationName","dosage"${cols}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8${vals})`,
      [
        `probe-${Math.random().toString(36).slice(2)}`,
        seedLog.medicationId,
        seedLog.stayId,
        'REFUSED',
        seedLog.observedById,
        seedLog.recordedById,
        'Probe',
        '1 tablet',
      ],
    )

  await rejects('a REFUSED dose with no note is refused by the CHECK', () => rawInsert('', ''))
  // The NULL case specifically: length(btrim(NULL)) is NULL and a CHECK passes
  // on NULL, so without the explicit IS NOT NULL this walks straight through.
  await rejects('…and an explicitly NULL note is refused too, not waved through', () =>
    rawInsert(',"note"', ',NULL'),
  )

  console.log('\n\x1b[1mAppend-only, both layers asserted separately\x1b[0m')

  // Layer one: the app role fails on PRIVILEGE, before any trigger is reached.
  await rejects('the app role cannot UPDATE a dose (privilege)', () =>
    runAsSystem(async () =>
      prisma.medLog.update({ where: { id: seedLog.id }, data: { note: 'edited' } }),
    ),
  )
  await rejects('the app role cannot DELETE a dose (privilege)', () =>
    runAsSystem(async () => prisma.medLog.delete({ where: { id: seedLog.id } })),
  )

  // Layer two: a superuser bypasses RLS and privilege both, and is stopped by
  // the trigger. A test that conflates the two proves neither.
  await rejects('a superuser cannot UPDATE a dose (trigger)', () =>
    owner.query(`UPDATE "med_logs" SET "note" = 'edited' WHERE "id" = $1`, [seedLog.id]),
  )
  await rejects('a superuser cannot DELETE a dose (trigger)', () =>
    owner.query(`DELETE FROM "med_logs" WHERE "id" = $1`, [seedLog.id]),
  )

  // The medication itself is deliberately NOT frozen — it is current state.
  const editable = await runAsSystem(async () =>
    prisma.medication.update({
      where: { id: seedLog.medicationId },
      data: { instructions: 'With a full glass of water' },
    }),
  )
  editable.instructions === 'With a full glass of water'
    ? ok('a MEDICATION is still editable — the standing instruction is not evidence')
    : bad('med editable', 'the medication refused an ordinary edit')

  // ── The amendment arc ────────────────────────────────────────────────────
  console.log('\n\x1b[1mCorrecting a dose is an amendment\x1b[0m')

  const before = await runAsSystem(async () => prisma.medLog.count())

  const noWhy = await tech(`/meds/logs/${seedLog.id}/amend`, {
    method: 'POST',
    body: JSON.stringify({ status: 'HELD', note: 'x' }),
  })
  noWhy.status === 400
    ? ok('an amendment with no reason is refused')
    : bad('amend reason', noWhy.status)

  const amended = await tech(`/meds/logs/${seedLog.id}/amend`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'HELD',
      note: 'Held pending a call to the prescriber.',
      amendmentReason: 'Recorded as given by mistake.',
    }),
  })
  amended.status === 201 ? ok('a tech can amend a dose') : bad('amend', amended.status)

  // The row count going UP is the append-only guarantee. "The amendment shows"
  // would pass with the original destroyed, which is the failure this whole
  // pattern exists to prevent.
  const afterCount = await runAsSystem(async () => prisma.medLog.count())
  afterCount === before + 1
    ? ok('the row count goes UP — the original was not rewritten')
    : bad('append', `${before} → ${afterCount}`)

  const original = await runAsSystem(async () =>
    prisma.medLog.findUnique({ where: { id: seedLog.id } }),
  )
  original && original.status === 'GIVEN'
    ? ok('…and the original is still readable, still saying GIVEN')
    : bad('original', original?.status ?? 'gone')

  const amendment = await runAsSystem(async () =>
    prisma.medLog.findUnique({ where: { id: amended.body.id } }),
  )
  amendment.scheduledFor?.getTime() === original.scheduledFor?.getTime()
    ? ok('the amendment carries the original’s slot verbatim')
    : bad('slot carried', `${original.scheduledFor} vs ${amendment.scheduledFor}`)
  amendment.medicationName === original.medicationName
    ? ok('…and its snapshot, so a later med edit cannot restate what was given')
    : bad('snapshot carried', amendment.medicationName)

  const forked = await tech(`/meds/logs/${seedLog.id}/amend`, {
    method: 'POST',
    body: JSON.stringify({ status: 'REFUSED', note: 'y', amendmentReason: 'fork attempt' }),
  })
  forked.status === 409
    ? ok('a second amendment of the same dose is refused — no forked chain')
    : bad('fork', forked.status)

  // Cross-medication, at the trigger. The service never offers this shape, so
  // the guard has to be proved where it actually lives.
  const otherMed = await runAsSystem(async () =>
    prisma.medication.findFirst({ where: { id: { not: seedLog.medicationId }, isPrn: false } }),
  )
  await rejects('an amendment cannot cross to another medication (trigger)', () =>
    owner.query(
      `INSERT INTO "med_logs" ("id","medicationId","stayId","scheduledFor","status","observedById","recordedById","medicationName","dosage","note","supersedesId","amendmentReason")
       VALUES ('probe-cross',$1,$2,$3,'HELD',$4,$4,'Probe','1','n',$5,'crossing')`,
      [otherMed.id, otherMed.stayId, original.scheduledFor, seedLog.observedById, amendment.id],
    ),
  )

  // ── The med list ─────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe med list is managers-only\x1b[0m')

  const resident = await runAsSystem(async () =>
    prisma.stay.findFirst({ where: { status: 'ACTIVE' }, select: { residentId: true, id: true } }),
  )

  const techAdds = await tech(`/residents/${resident.residentId}/medications`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Probe', dosage: '1 tablet', times: ['09:00'] }),
  })
  techAdds.status === 403
    ? ok('a tech cannot add a medication — that is not a hallway act')
    : bad('tech adds', techAdds.status)

  const added = await manager(`/residents/${resident.residentId}/medications`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Probe med',
      dosage: '1 tablet',
      times: ['09:00'],
      startsOn: '2026-05-01',
    }),
  })
  added.status === 201 ? ok('a manager can') : bad('manager adds', added.status)

  const prnWithTimes = await manager(`/residents/${resident.residentId}/medications`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Bad',
      dosage: '1',
      times: ['09:00'],
      isPrn: true,
      startsOn: '2026-05-01',
    }),
  })
  prnWithTimes.status === 400
    ? ok('an as-needed medication carrying scheduled times is refused')
    : bad('prn times', prnWithTimes.status)

  const noTimes = await manager(`/residents/${resident.residentId}/medications`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Bad', dosage: '1', times: [], startsOn: '2026-05-01' }),
  })
  noTimes.status === 400
    ? ok('a scheduled medication with no times is refused')
    : bad('no times', noTimes.status)

  const badTime = await manager(`/residents/${resident.residentId}/medications`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Bad', dosage: '1', times: ['8:00'], startsOn: '2026-05-01' }),
  })
  badTime.status === 400
    ? ok('a malformed wall-clock time is refused before it reaches a Date')
    : bad('bad time', badTime.status)

  // An empty patch is a 400 — the verify-schedule.js precedent. This is also
  // what catches a `.default([])` creeping onto the patch shape, which would
  // make {name} parse to {name, times: []} and silently clear the schedule.
  const emptyPatch = await manager(`/meds/medications/${added.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  })
  emptyPatch.status === 400 ? ok('an empty patch is a 400') : bad('empty patch', emptyPatch.status)

  const renamed = await manager(`/meds/medications/${added.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Probe med renamed' }),
  })
  renamed.status === 200 && renamed.body.times.length === 1
    ? ok('a patch of one field leaves the schedule alone')
    : bad('patch times', JSON.stringify(renamed.body?.times))

  // ── Deleting versus discontinuing ────────────────────────────────────────
  console.log('\n\x1b[1mA medication with doses is ended, never deleted\x1b[0m')

  const unused = await manager(`/meds/medications/${added.body.id}`, { method: 'DELETE' })
  unused.status === 200
    ? ok('a medication with nothing recorded can be removed outright')
    : bad('delete unused', unused.status)

  const usedDelete = await manager(`/meds/medications/${seedLog.medicationId}`, { method: 'DELETE' })
  usedDelete.status === 409
    ? ok('one with doses recorded refuses deletion, pointing at discontinue')
    : bad('delete used', usedDelete.status)

  const stillThere = await runAsSystem(async () =>
    prisma.medication.findFirst({ where: { id: seedLog.medicationId, deletedAt: null } }),
  )
  stillThere
    ? ok('…and it is genuinely still there, not soft-deleted behind the 409')
    : bad('still there', 'the medication was removed anyway')

  // Ending it before its last recorded dose would orphan that dose through the
  // activeOnDate filter — the same failure expand() has when weekdays change
  // under a taken roll. Ending a series is the SANCTIONED act, which is what
  // makes this the easiest guard here to ship a bug in.
  const tooEarly = await manager(`/meds/medications/${seedLog.medicationId}/discontinue`, {
    method: 'POST',
    body: JSON.stringify({ endsOn: '2026-05-02', endReason: 'Backdating past a recorded dose' }),
  })
  tooEarly.status === 409
    ? ok('a medication cannot end before a dose already recorded against it')
    : bad('end early', tooEarly.status)

  const noEndReason = await manager(`/meds/medications/${seedLog.medicationId}/discontinue`, {
    method: 'POST',
    body: JSON.stringify({ endsOn: '2026-12-01' }),
  })
  noEndReason.status === 400
    ? ok('discontinuing with no reason is refused')
    : bad('end reason', noEndReason.status)

  // ── The day a medication is discontinued ─────────────────────────────────
  // BOTH halves, because either alone passes a broken implementation: "the
  // unrecorded dose is gone" passes if every dose was dropped, and "the
  // recorded dose survives" passes if nothing was filtered at all.
  console.log('\n\x1b[1mOn its final day, only recorded doses of a medication remain\x1b[0m')

  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.FACILITY_TIMEZONE ?? 'America/New_York',
    }).format(new Date())
  const nowHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.FACILITY_TIMEZONE ?? 'America/New_York',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()),
  )
  const past = `${String(Math.max(nowHour - 1, 0)).padStart(2, '0')}:00`
  const ahead = `${String(Math.min(nowHour + 2, 23)).padStart(2, '0')}:00`

  if (past !== ahead) {
    const ending = await manager(`/residents/${resident.residentId}/medications`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Endingprobe',
        dosage: '1 tablet',
        times: [past, ahead],
        startsOn: '2026-05-01',
      }),
    })
    // Record only the earlier of its two doses, then stop the medication today.
    await tech('/meds/logs', {
      method: 'POST',
      body: JSON.stringify({
        stayId: resident.id,
        observedById: techUser.id,
        entries: [{ medicationId: ending.body.id, time: past, status: 'GIVEN' }],
      }),
    })
    const stopped = await manager(`/meds/medications/${ending.body.id}/discontinue`, {
      method: 'POST',
      body: JSON.stringify({ endsOn: todayKey, endReason: 'Prescriber stopped it.' }),
    })
    stopped.status === 200
      ? ok('a medication can be discontinued on a day it already has a dose')
      : bad('discontinue today', stopped.status)

    const boardAfterStop = await tech('/meds')
    const slots = boardAfterStop.body.passes.flatMap((p) =>
      p.residents.some((r) => r.stayId === resident.id) ? [p.time] : [],
    )
    const stillOpen = await tech(`/meds/pass/${resident.id}`)
    const mine = stillOpen.body.doses.filter((d) => d.medicationId === ending.body.id)

    mine.some((d) => d.time === past && d.log)
      ? ok('the dose already given that day is KEPT — the record survives')
      : bad('kept recorded', JSON.stringify(mine.map((d) => d.time)))
    !mine.some((d) => d.time === ahead)
      ? ok('…and the one never given is gone, so it can never read MISSED')
      : bad('dropped unrecorded', 'a discontinued medication still has a dose pending')
    void slots
  }

  // ── A discharge costs no write ───────────────────────────────────────────
  // The property that stay-scoping buys, and the reason a med list hangs off
  // Stay rather than Resident.
  console.log('\n\x1b[1mA discharge drops future doses with no write\x1b[0m')

  const discharged = await runAsSystem(async () =>
    prisma.stay.findFirst({ where: { status: 'DISCHARGED' }, select: { id: true, residentId: true } }),
  )
  if (discharged) {
    const beforeMeds = await runAsSystem(async () => prisma.medication.count())
    await runAsSystem(async () =>
      prisma.medication.create({
        data: {
          stayId: discharged.id,
          name: 'Ghost',
          dosage: '1 tablet',
          times: ['09:00'],
          startsOn: new Date('2026-05-01T00:00:00Z'),
          addedById: techUser.id,
        },
      }),
    )
    const boardAfter = await tech('/meds')
    const named = JSON.stringify(boardAfter.body)
    const ghostStay = boardAfter.body.passes.some((p) =>
      p.residents.some((r) => r.stayId === discharged.id),
    )
    !ghostStay
      ? ok('a discharged resident’s medication never appears on the board')
      : bad('ghost', 'a discharged stay is on the pass')
    const afterMeds = await runAsSystem(async () => prisma.medication.count())
    afterMeds === beforeMeds + 1
      ? ok('…and nothing was deleted to achieve it — the filter is the mechanism')
      : bad('ghost write', `${beforeMeds} → ${afterMeds}`)

    const recordRead = await tech(`/residents/${discharged.residentId}/meds`)
    recordRead.status === 200 && recordRead.body.hasActiveStay === false
      ? ok('their record still opens, saying there is no active stay')
      : bad('discharged record', recordRead.status)
  }

  // ── The bell ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe bell carries a count, never a name or a medication\x1b[0m')

  const bellText = JSON.stringify(bellWhileDue.body)

  !seededDrugs.test(bellText)
    ? ok('no medication name reaches the bell')
    : bad('bell drug leak', bellText.match(seededDrugs)?.[0])

  medItem
    ? ok('the med pass item DOES fire while doses are due — it is not simply absent')
    : bad('bell item', 'no MED_PASS_DUE item while the seed has a due dose')

  if (medItem) {
    const residents = await runAsSystem(async () =>
      prisma.resident.findMany({ select: { firstName: true, lastName: true } }),
    )
    const text = `${medItem.title} ${medItem.detail}`
    const namesInItem = residents.filter(
      (r) => text.includes(r.firstName) || text.includes(r.lastName),
    )
    namesInItem.length === 0
      ? ok('…and names no resident — a count and a time, which is the whole rule')
      : bad('bell name leak', namesInItem[0].lastName)
    medItem.to === '/meds'
      ? ok('…and links somewhere a tech can actually open')
      : bad('bell dest', medItem.to)
  }

  // The dashboard is the other ambient surface, and greets every unlock.
  const dash = await tech('/dashboard')
  !seededDrugs.test(JSON.stringify(dash.body))
    ? ok('no medication reaches the dashboard either')
    : bad('dash leak', 'a medication name is on the dashboard payload')

  // The bell must CLEAR itself, or it is a stored notification wearing a
  // derivation's clothes. Marking every due dose is what proves it.
  const boardNow = await tech('/meds')
  for (const p of boardNow.body.passes.filter((x) => x.due > 0)) {
    for (const r of p.residents.filter((x) => x.due > 0)) {
      const s = await tech(`/meds/pass/${r.stayId}`)
      const due = s.body.doses.filter((d) => d.state === 'DUE')
      if (due.length) {
        await post({
          stayId: r.stayId,
          observedById: techUser.id,
          entries: due.map((d) => ({ medicationId: d.medicationId, time: d.time, status: 'GIVEN' })),
        })
      }
    }
  }
  const bellCleared = await tech('/notifications')
  !bellCleared.body.items.some((i) => i.kind === 'MED_PASS_DUE')
    ? ok('recording every due dose clears the item — nothing stored, nothing stale')
    : bad('bell clear', 'the med item survived every dose being recorded')

  // ── Row-level security ───────────────────────────────────────────────────
  console.log('\n\x1b[1mRow-level security\x1b[0m')

  // `mine` must be a stay that ACTUALLY HAS DOSES, or "the resident sees their
  // own" passes vacuously on an empty table while the policy denies everything.
  const withDoses = await runAsSystem(async () =>
    prisma.medLog.findFirst({ select: { stayId: true } }),
  )
  const mine = await runAsSystem(async () =>
    prisma.stay.findUnique({
      where: { id: withDoses.stayId },
      select: { id: true, residentId: true },
    }),
  )
  const theirs = await runAsSystem(async () =>
    prisma.stay.findFirst({
      where: { status: 'ACTIVE', id: { not: mine.id }, medications: { some: {} } },
      select: { id: true, residentId: true },
    }),
  )

  // `async () => await …` throughout, not `() => …`. A PrismaPromise is LAZY:
  // returned unawaited, it escapes the resident context and executes under
  // whatever ambient actor the suite is running as — which is runAsSystem, so
  // every policy passes and every row comes back. That reads as a leak while
  // testing nothing at all. This is the trap CLAUDE.md names, and it cost a
  // false failure here before it was spotted.
  const ownDoses = await runWithDbActor(
    { kind: ACTOR.RESIDENT, residentId: mine.residentId },
    async () => await prisma.medLog.findMany({ where: { stayId: mine.id } }),
  )
  const otherDoses = await runWithDbActor(
    { kind: ACTOR.RESIDENT, residentId: mine.residentId },
    async () => await prisma.medLog.findMany({ where: { stayId: theirs.id } }),
  )
  otherDoses.length === 0
    ? ok('a resident cannot read another resident’s doses')
    : bad('rls doses', `${otherDoses.length} rows leaked`)
  // Both directions, and this half is the one that matters: "sees nothing"
  // passes just as well when the policy denies EVERYTHING, which would be a
  // broken policy wearing a secure one's clothes.
  ownDoses.length > 0
    ? ok(`…and CAN read their own — ${ownDoses.length}, so the policy is not simply denying all`)
    : bad('rls own', 'the resident could not read their own doses either')

  const otherMeds = await runWithDbActor(
    { kind: ACTOR.RESIDENT, residentId: mine.residentId },
    async () => await prisma.medication.findMany({ where: { stayId: theirs.id } }),
  )
  otherMeds.length === 0
    ? ok('nor another resident’s medication list')
    : bad('rls meds', `${otherMeds.length} rows leaked`)

  // ── Audit ────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mAudit\x1b[0m')

  const audited = await owner.query(
    `SELECT count(*)::int AS n FROM "audit_log" WHERE "entity" IN ('MedLog','Medication')`,
  )
  audited.rows[0].n > 0
    ? ok('doses and medications are written to the audit log')
    : bad('audit', 'nothing was audited')

  const leaky = await owner.query(
    `SELECT count(*)::int AS n FROM "audit_log"
      WHERE "entity" IN ('MedLog','Medication')
        AND ("entityId" ILIKE '%Sertraline%' OR "entityId" ILIKE '%Metformin%'
             OR "entityId" ILIKE '%mg%')`,
  )
  leaky.rows[0].n === 0
    ? ok('…carrying ids only, never a medication name or a dose')
    : bad('audit leak', `${leaky.rows[0].n} rows carry drug text`)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  await owner.end()
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => {
  console.error(e)
  process.exit(1)
})
