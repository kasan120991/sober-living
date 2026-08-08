/**
 * Travel passes — approval, and what an approved absence does to four other
 * modules.
 *
 * What this proves: eligibility is enforced per phase, in BOTH directions;
 * filing is all-staff and deciding is managers; the arc runs once and forwards;
 * a denial without a reason is refused at the route AND by the CHECK; the
 * one-hour grace lands either side of a fixed instant; THE BED IS STILL HELD,
 * which is the module's headline claim and the one thing a reader would assume
 * rather than check; a resident away on a pass is pre-accounted on the hourly
 * round and is ABSENT from the bell's unaccounted list; their doses do not
 * appear as due; the roll sheet is told; the request half is immutable against
 * the app role by privilege and against a superuser by trigger, asserted
 * separately; and RLS scopes a resident to their own passes.
 *
 * WHY THIS SUITE OWNS ITS FIXTURE. The seed deliberately holds NO pass that is
 * active right now: a pass outranks a sign-out in presenceOf(), so seeding one
 * on any housed resident silently rewrote a fixture verify-signouts or
 * verify-checks depends on. Everything about being away is therefore created
 * here, and torn down at the end — but a reseed afterwards is still the honest
 * habit, since a review is append-only and cannot be undone.
 *
 * Run after `node scripts/seed.js`.
 */
import { createApp } from '../src/app.js'
import { prisma } from '../src/db/client.js'
import { ACTOR, runAsSystem, runWithDbActor } from '../src/lib/dbContext.js'
import { PASS_GRACE_MS } from '../src/domain/constants.js'
import { coversInstant, passEligibility, passOverdueCutoff } from '../src/services/passes.js'

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
const DAY = 86_400_000

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

  // The owner connection, for what only a superuser can prove: that the CHECKs
  // and the arc trigger hold against direct SQL. Raw SQL through the app client
  // cannot stand in — with no actor context RLS fail-closes, the statement
  // matches zero rows, and that looks like a pass while testing nothing.
  const pg = (await import('pg')).default
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await owner.connect()

  // ── The gate ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe gate\x1b[0m')

  const anon = await fetch(`${base}/passes`)
  anon.status === 401 ? ok('anonymous is refused') : bad('anon 401', anon.status)

  const board = await tech('/passes')
  board.status === 200
    ? ok('a tech reads the board — filing a request is all-staff work')
    : bad('tech reads board', board.status)

  // ── Eligibility, with no database ────────────────────────────────────────
  // The pace-rule idiom from verify-service: the predicate is pure, so its
  // corners are provable without seeding a resident for each one. The route
  // assertions below then prove the pure rule is actually the one in force.
  console.log('\n\x1b[1mEligibility (pure)\x1b[0m')

  const at = (days) => new Date(Date.UTC(2026, 4, 1) + days * DAY)
  const stayOn = (program, days = 365) => ({
    status: 'ACTIVE',
    intakeAt: at(0),
    program,
  })
  const ORIENTATION = { name: 'Orientation', passEligible: false, minDaysBeforePass: null }
  const PHASE1 = { name: 'Phase 1', passEligible: true, minDaysBeforePass: 90 }

  passEligibility(stayOn(ORIENTATION), at(400)).eligible === false
    ? ok('Orientation is never eligible, however long somebody has been here')
    : bad('orientation refused', 'it was allowed')

  const d89 = passEligibility(stayOn(PHASE1), at(89))
  d89.eligible === false && d89.reason.includes('90')
    ? ok(`Phase 1 at day 89 is refused, and the reason names the rule — "${d89.reason}"`)
    : bad('day 89 refused', JSON.stringify(d89))

  passEligibility(stayOn(PHASE1), at(90)).eligible === true
    ? ok('Phase 1 at day 90 is eligible — the boundary is inclusive, not "over 90"')
    : bad('day 90 allowed', 'it was refused')

  // Null is the state both columns sat in from the schema being written until
  // the facility answered. The conservative reading of an unset privilege is
  // that it is NOT granted — the same posture as a null service-hours target.
  passEligibility(stayOn({ name: 'Unset', passEligible: null }), at(400)).eligible === false
    ? ok('a phase with an UNSET policy is refused — null reads as not granted')
    : bad('null policy refused', 'it was allowed')

  passEligibility({ status: 'DISCHARGED', intakeAt: at(0), program: PHASE1 }, at(400)).eligible === false
    ? ok('a discharged stay is refused — a pass belongs to a live stay')
    : bad('discharged refused', 'it was allowed')

  // ── The grace, on fixed instants ─────────────────────────────────────────
  // One hour, its own knob — NOT the sign-out's fifteen minutes. An hour late
  // back from a weekend away is a different event from an hour late back from
  // the shop, and collapsing the two would make one of the alarms wrong.
  console.log('\n\x1b[1mThe one-hour grace\x1b[0m')

  PASS_GRACE_MS === 60 * MIN
    ? ok('PASS_GRACE_MS is one hour, and is its own knob beside OVERDUE_GRACE_MS')
    : bad('grace is an hour', PASS_GRACE_MS)

  const T = new Date('2026-08-08T18:00:00Z')
  const late = (mins) => new Date(T.getTime() - mins * MIN) < passOverdueCutoff(T)
  late(59) === false && late(61) === true
    ? ok('59 minutes late is not overdue; 61 minutes is — the grace lands where it should')
    : bad('grace boundary', `59:${late(59)} 61:${late(61)}`)

  // The bound that a reader would get backwards, and the bug that was actually
  // shipped and caught: an OVERDUE pass is STILL AN ABSENCE. If coversInstant
  // required returnBy >= at, then at the moment somebody became overdue the
  // census would drop them to "in", the round would stop pre-accounting them,
  // and their doses would come due — the app would quietly assert a resident
  // was home because they had failed to come home.
  coversInstant({ departAt: new Date(T - 3 * DAY), returnBy: new Date(T - 5 * 60 * MIN) }, T)
    ? ok('a pass five hours past its return still COVERS the resident — overdue is not "back"')
    : bad('overdue still covers', 'it stopped covering')

  coversInstant({ departAt: new Date(T.getTime() + DAY), returnBy: new Date(T.getTime() + 3 * DAY) }, T)
    ? bad('future pass does not cover', 'it covered')
    : ok('an approved pass for next week does NOT cover today — it is not an absence yet')

  // ── Filing, and what a phase refuses ─────────────────────────────────────
  console.log('\n\x1b[1mFiling a request\x1b[0m')

  const residents = (await tech('/residents?includeDischarged=true')).body.residents
  const byLast = (l) => residents.find((r) => r.lastName === l)
  const whitfield = byLast('Whitfield')   // Phase 2, intaked 1 May — well past 90 days
  const nakamura = byLast('Nakamura')     // Phase 1, intaked TODAY — day 0

  const day = (offset) => {
    const d = new Date(Date.now() + offset * DAY)
    return d.toISOString().slice(0, 10)
  }
  const request = (who, over, body = {}) =>
    who(`/residents/${over}/passes`, {
      method: 'POST',
      body: JSON.stringify({
        destination: 'Family visit — Savannah',
        departDate: day(20),
        departTime: '09:00',
        returnDate: day(22),
        returnTime: '18:00',
        ...body,
      }),
    })

  const tooSoon = await request(tech, nakamura.id)
  tooSoon.status === 409 && /day 0|90/.test(tooSoon.body?.error ?? '')
    ? ok(`a Phase 1 resident on day 0 is refused BY THE ROUTE — "${tooSoon.body.error}"`)
    : bad('under-90 refused at the route', `${tooSoon.status} ${JSON.stringify(tooSoon.body)}`)

  const filed = await request(tech, whitfield.id)
  filed.status === 201
    ? ok('a TECH files a request — the person a resident actually asks')
    : bad('tech files', `${filed.status} ${JSON.stringify(filed.body)}`)
  const passId = filed.body?.id

  const clash = await request(tech, whitfield.id)
  clash.status === 409
    ? ok('a second request over the same window is refused — one absence at a time')
    : bad('overlap refused', clash.status)

  const backwards = await request(tech, whitfield.id, {
    departDate: day(40), departTime: '18:00', returnDate: day(40), returnTime: '09:00',
  })
  backwards.status === 400
    ? ok('a return before its departure is refused')
    : bad('window ordered at the route', backwards.status)

  await rejects('…and the CHECK refuses it too, against a superuser', () =>
    owner.query(
      `UPDATE "travel_passes" SET "returnBy" = "departAt" - interval '1 day' WHERE id = $1`,
      [passId],
    ),
  )

  // ── Reviewing ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe review\x1b[0m')

  const techReviews = await tech(`/passes/${passId}/review`, {
    method: 'POST',
    body: JSON.stringify({ approve: true }),
  })
  techReviews.status === 403
    ? ok('a tech cannot decide one — filing is a hallway act, deciding is a judgement')
    : bad('tech refused review', techReviews.status)

  const noReason = await manager(`/passes/${passId}/review`, {
    method: 'POST',
    body: JSON.stringify({ approve: false }),
  })
  noReason.status === 400
    ? ok('a denial with no reason is refused at the route')
    : bad('denial needs a reason (route)', noReason.status)

  await rejects('…and by the CHECK, against a superuser writing DENIED with no note', () =>
    owner.query(
      `UPDATE "travel_passes" SET "status" = 'DENIED', "reviewedAt" = now(),
         "reviewedById" = (SELECT id FROM users WHERE email = 'manager@facility.test')
       WHERE id = $1`,
      [passId],
    ),
  )

  // The bed, before and after. This is the module's headline claim and the one
  // a reader is most likely to assume rather than check — so it is asserted on
  // the ROW, not on a count: an assignment ended and re-created would leave the
  // census looking identical while rewriting permanent bed history.
  const bedBefore = await runAsSystem(async () =>
    await prisma.bedAssignment.findFirst({
      where: { stay: { residentId: whitfield.id }, endedAt: null },
    }),
  )

  const approved = await manager(`/passes/${passId}/review`, {
    method: 'POST',
    body: JSON.stringify({ approve: true }),
  })
  approved.status === 200 && approved.body.status === 'APPROVED'
    ? ok('a manager approves it')
    : bad('manager approves', `${approved.status} ${JSON.stringify(approved.body)}`)

  const bedAfter = await runAsSystem(async () =>
    await prisma.bedAssignment.findFirst({
      where: { stay: { residentId: whitfield.id }, endedAt: null },
    }),
  )
  bedAfter && bedAfter.id === bedBefore.id && +bedAfter.startedAt === +bedBefore.startedAt
    ? ok('THE BED IS STILL HELD — the same assignment row, unchanged and still open')
    : bad('bed held', `${bedBefore?.id} → ${bedAfter?.id}`)

  const denyAgain = await manager(`/passes/${passId}/review`, {
    method: 'POST',
    body: JSON.stringify({ approve: false, note: 'Changed my mind.' }),
  })
  denyAgain.status === 409
    ? ok('an APPROVED pass cannot then be denied — the arc runs once')
    : bad('arc runs once', denyAgain.status)

  const withdraw = await tech(`/passes/${passId}`, { method: 'DELETE' })
  withdraw.status === 409
    ? ok('a reviewed pass cannot be withdrawn — the decision is part of the record')
    : bad('withdraw refused after review', withdraw.status)

  await rejects('the arc will not run backwards, even for a superuser', () =>
    owner.query(`UPDATE "travel_passes" SET "status" = 'REQUESTED' WHERE id = $1`, [passId]),
  )

  // ── The request half is immutable ────────────────────────────────────────
  console.log('\n\x1b[1mAppend-only, at both layers\x1b[0m')

  await rejects('the APP ROLE cannot change a destination — refused on privilege', () =>
    runAsSystem(async () =>
      await prisma.travelPass.update({
        where: { id: passId },
        data: { destination: 'Somewhere else' },
      }),
    ),
  )

  await rejects('a SUPERUSER cannot either — refused by the trigger', () =>
    owner.query(`UPDATE "travel_passes" SET "destination" = 'Somewhere else' WHERE id = $1`, [passId]),
  )

  // The whole-row comparison, which is the reason the trigger is written that
  // way: a column nobody thought about is immutable BY DEFAULT.
  await rejects('a column in no whitelist is immutable by default (purpose)', () =>
    owner.query(`UPDATE "travel_passes" SET "purpose" = 'rewritten' WHERE id = $1`, [passId]),
  )

  await rejects('DELETE is revoked — a withdrawn request is soft', () =>
    owner.query(`SET ROLE soberlife_app; DELETE FROM "travel_passes" WHERE id = $1`, [passId]),
  )
  await owner.query('RESET ROLE')

  // ── Away right now ───────────────────────────────────────────────────────
  // Created directly, with instants the wall-clock route cannot conveniently
  // express, and OWNED by this suite — see the note at the top of the file.
  console.log('\n\x1b[1mAway on a pass\x1b[0m')

  const ferrer = byLast('Ferrer')
  const managerUser = await runAsSystem(async () =>
    await prisma.user.findUnique({ where: { email: 'manager@facility.test' } }),
  )
  const ferrerStay = await runAsSystem(async () =>
    await prisma.stay.findFirst({ where: { residentId: ferrer.id, status: 'ACTIVE' } }),
  )

  // Counted BEFORE the pass exists, so the assertion at the end of the roll
  // section compares two different moments rather than a value with itself.
  const marksBefore = await runAsSystem(async () =>
    await prisma.scheduleAttendance.count({ where: { stayId: ferrerStay.id } }),
  )

  const away = await runAsSystem(async () =>
    await prisma.travelPass.create({
      data: {
        stayId: ferrerStay.id,
        destination: 'Aunt’s house — Columbus, GA',
        purpose: 'Family visit',
        departAt: new Date(Date.now() - 2 * DAY),
        // Two hours past, which is beyond the one-hour grace — so this single
        // fixture proves the away behaviour AND the overdue alarm at once.
        returnBy: new Date(Date.now() - 2 * 60 * MIN),
        status: 'APPROVED',
        requestedById: managerUser.id,
        reviewedById: managerUser.id,
        reviewedAt: new Date(Date.now() - 3 * DAY),
      },
    }),
  )

  // ── The census ───────────────────────────────────────────────────────────
  const censusBefore = (await tech('/census')).body
  const tileOf = (c) =>
    c.apartments.flatMap((a) => a.beds).find((b) => b.resident?.id === ferrer.id)

  const tile = tileOf(censusBefore)
  tile?.resident
    ? ok('the census tile still names her — the bed is occupied, not freed')
    : bad('tile still occupied', JSON.stringify(tile))

  tile?.presence?.state === 'PASS_OVERDUE'
    ? ok('…and its presence reads PASS_OVERDUE, not IN and not OUT')
    : bad('tile presence', tile?.presence?.state)

  tile?.presence?.destination === undefined
    ? ok('the tile carries NO destination — this board is read over a shoulder')
    : bad('tile withholds destination', tile.presence.destination)

  censusBefore.figures.passOverdue === 1
    ? ok('the figures count her as overdue back from a pass')
    : bad('figures.passOverdue', censusBefore.figures.passOverdue)

  // ── The bell ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe bell\x1b[0m')

  const bell = (await tech('/notifications')).body
  const late1 = bell.items.find((i) => i.kind === 'PASS_OVERDUE' && i.title.includes('Ferrer'))
  late1
    ? ok('the bell carries an overdue-pass item')
    : bad('bell item', JSON.stringify(bell.items.map((i) => i.kind)))

  late1?.detail?.includes('Columbus')
    ? ok('…and it DOES carry the destination — whoever chases her needs a place to start')
    : bad('bell item names the destination', late1?.detail)

  // ── The dashboard ────────────────────────────────────────────────────────
  // Asserted HERE rather than in verify-dashboard.js, because the fixture is
  // here: the seed has no active pass on purpose, and creating one over there
  // would reintroduce the exact fixture collision this suite exists to avoid.
  console.log('\n\x1b[1mThe dashboard\x1b[0m')

  const dash = (await tech('/dashboard')).body
  const dashRow = (dash.attention.passOverdue ?? []).find((p) => p.fullName.includes('Ferrer'))
  dashRow
    ? ok('the landing page carries the overdue pass — the screen that greets every unlock')
    : bad('dashboard row', JSON.stringify(dash.attention.passOverdue))

  dashRow?.destination?.includes('Columbus')
    ? ok('…with the destination, like the overdue sign-out row beside it')
    : bad('dashboard names the destination', dashRow?.destination)

  // The bell and this panel derive through one helper, so they cannot name
  // different people. That is the whole reason overduePasses() exists.
  const bellIds = bell.items.filter((i) => i.kind === 'PASS_OVERDUE').map((i) => i.id.slice(5))
  const dashIds = (dash.attention.passOverdue ?? []).map((p) => p.id)
  JSON.stringify([...bellIds].sort()) === JSON.stringify([...dashIds].sort())
    ? ok('the bell and the panel name exactly the same passes — one knob behind both')
    : bad('bell equals panel', `${bellIds} vs ${dashIds}`)

  // ── The hourly round ─────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe hourly round\x1b[0m')

  const apt = censusBefore.apartments.find((a) => a.beds.some((b) => b.resident?.id === ferrer.id))
  const roster = (await tech(`/checks/roster/${apt.id}`)).body
  const line = roster.people.find((r) => r.residentId === ferrer.id)

  line?.presence?.state === 'PASS_OVERDUE'
    ? ok('the round PRE-ACCOUNTS her — the pass is the record, so there is no tap to make')
    : bad('roster pre-accounts', JSON.stringify(line?.presence))

  line?.destination === undefined && !JSON.stringify(line ?? {}).includes('Columbus')
    ? ok('…and the roster line carries no destination either')
    : bad('roster withholds destination', JSON.stringify(line))

  const others = roster.people.filter((r) => r.residentId !== ferrer.id)
  const lines = [
    { stayId: ferrerStay.id, status: 'ON_PASS' },
    ...others.map((r) => ({ stayId: r.stayId, status: 'PRESENT', note: 'In room' })),
  ]
  const check = await tech('/checks', {
    method: 'POST',
    body: JSON.stringify({ apartmentId: apt.id, lines }),
  })
  check.status === 201
    ? ok('a round records her as ON_PASS — its own status, never overloaded onto SIGNED_OUT')
    : bad('ON_PASS accepted', `${check.status} ${JSON.stringify(check.body)}`)

  const notFound = await tech('/checks', {
    method: 'POST',
    body: JSON.stringify({
      apartmentId: apt.id,
      lines: [
        { stayId: ferrerStay.id, status: 'NOT_FOUND' },
        ...others.map((r) => ({ stayId: r.stayId, status: 'PRESENT', note: 'In room' })),
      ],
    }),
  })
  notFound.status === 409
    ? ok('NOT_FOUND is refused for her — the pass accounts for her, so "missing" is untrue')
    : bad('NOT_FOUND refused', notFound.status)

  // The pair that matters, and the direction a cheap assertion would miss: not
  // merely that the round accepted ON_PASS, but that the bell does NOT then
  // shout that a resident is unaccounted for. A person on an approved pass is
  // accounted for by definition.
  const bell2 = (await tech('/notifications')).body
  bell2.items.some((i) => i.kind === 'RESIDENT_NOT_ACCOUNTED' && i.title.includes('Ferrer'))
    ? bad('not unaccounted', 'the bell says she is unaccounted for')
    : ok('the bell does NOT call her unaccounted for — an approved absence is accounted for')

  // ── Med pass ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mMed pass\x1b[0m')

  const meds = (await tech('/meds')).body
  const hasFerrerDose = JSON.stringify(meds).includes(ferrer.id)
  const ferrerMeds = await runAsSystem(async () =>
    await prisma.medication.count({ where: { stayId: ferrerStay.id, deletedAt: null } }),
  )
  ferrerMeds > 0
    ? ok(`she has ${ferrerMeds} active medication(s) — so the next assertion means something`)
    : bad('fixture has medications', 'none, the dose assertion would pass vacuously')

  !hasFerrerDose
    ? ok('her doses do NOT appear on the board — a pass is not a run of missed medication')
    : bad('doses suppressed', 'a dose for her is still on the board')

  // ── The roll sheet ───────────────────────────────────────────────────────
  console.log('\n\x1b[1mGroup attendance\x1b[0m')

  // Bands, not a flat list — there is no server endpoint returning one, and
  // there must never be. A session is addressed by (eventId, date).
  const sched = (await tech('/schedule')).body
  const bands = [sched.shared, ...sched.lanes]
  const all = bands.flatMap((b) => b.days.flatMap((d) => d.sessions))
  const withHer = []
  for (const s of all.slice(0, 14)) {
    const r = await tech(`/schedule/roll?eventId=${s.eventId}&date=${s.date}`)
    if (r.status !== 200) continue
    const p = r.body.people?.find((x) => x.stayId === ferrerStay.id)
    if (p) withHer.push(p)
  }
  withHer.length
    ? ok(`she is on ${withHer.length} roll(s) — so the flag below is being read from a real roster`)
    : bad('on a roll', 'no session carries her, the next assertion would be vacuous')

  withHer.every((p) => p.onPass)
    ? ok('every roll flags her as on a pass — the sheet pre-selects EXCUSED, nothing is written ahead')
    : bad('roll flags onPass', JSON.stringify(withHer.map((p) => p.onPass)))

  // Nothing was WRITTEN by approving the pass. That is the decision this design
  // rests on: an EXCUSED mark written at approval would count as attendance in
  // recordedAgainst(), freezing the event's shape and refusing a manager's
  // reschedule with a 409 that gives no hint why.
  const marksNow = await runAsSystem(async () =>
    await prisma.scheduleAttendance.count({ where: { stayId: ferrerStay.id } }),
  )
  marksNow === marksBefore
    ? ok(`the pass wrote NO attendance rows (${marksBefore} before, ${marksNow} after)`)
    : bad('no marks written', `${marksBefore} → ${marksNow}`)

  // ── Returning ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe return\x1b[0m')

  const returned = await tech(`/passes/${away.id}/return`, { method: 'POST' })
  returned.status === 200 && returned.body.status === 'RETURNED'
    ? ok('a TECH acknowledges the return — the person at the door sees them walk in')
    : bad('tech returns', `${returned.status} ${JSON.stringify(returned.body)}`)

  const bell3 = (await tech('/notifications')).body
  bell3.items.some((i) => i.kind === 'PASS_OVERDUE')
    ? bad('bell clears', 'the overdue item is still there')
    : ok('the bell item CLEARS itself on the return — derived, so nothing has to be dismissed')

  const dashAfter = (await tech('/dashboard')).body
  ;(dashAfter.attention.passOverdue ?? []).length === 0
    ? ok('…and so does the dashboard row — derived, so a return is the whole fix')
    : bad('dashboard clears', JSON.stringify(dashAfter.attention.passOverdue))

  const censusAfter = (await tech('/census')).body
  tileOf(censusAfter)?.presence?.state === 'IN'
    ? ok('…and her tile goes quiet again')
    : bad('tile back to IN', tileOf(censusAfter)?.presence?.state)

  const returnTwice = await tech(`/passes/${away.id}/return`, { method: 'POST' })
  returnTwice.status === 409
    ? ok('a returned pass cannot be returned again')
    : bad('return once', returnTwice.status)

  // ── RLS ──────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mRow-level security\x1b[0m')

  const asResident = (residentId, fn) =>
    runWithDbActor({ kind: ACTOR.RESIDENT, residentId }, async () => await fn())

  const hers = await asResident(ferrer.id, () => prisma.travelPass.findMany())
  hers.length > 0 && hers.every((p) => p.stayId === ferrerStay.id)
    ? ok(`a resident reads her OWN passes (${hers.length}, all hers) — what the portal will show`)
    : bad('own passes readable', `${hers.length} rows`)

  const notHers = await asResident(ferrer.id, () =>
    prisma.travelPass.count({ where: { stayId: { not: ferrerStay.id } } }),
  )
  notHers === 0
    ? ok('…and cannot see anybody else’s, even asking for them by stay')
    : bad('other passes hidden', notHers)

  await rejects('a resident cannot WRITE a pass — filing stays a staff act for now', () =>
    asResident(ferrer.id, () =>
      prisma.travelPass.create({
        data: {
          stayId: ferrerStay.id,
          destination: 'Anywhere',
          departAt: new Date(),
          returnBy: new Date(Date.now() + DAY),
          requestedById: managerUser.id,
        },
      }),
    ),
  )

  await owner.end()
  server.close()

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
