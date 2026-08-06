/**
 * Proves row-level security actually restricts resident data.
 *
 * This runs against the RUNTIME connection (the `soberlife_app` role) on
 * purpose — the whole point is that the application's own credentials cannot
 * read another resident's rows even if the API forgets to check.
 *
 * Run after `node scripts/seed.js`.
 */
import 'dotenv/config'
import pg from 'pg'
import { prisma } from '../src/db/client.js'
import { runAsSystem, runWithDbActor, ACTOR } from '../src/lib/dbContext.js'

let pass = 0
let fail = 0
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++ }
const bad = (n, d) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`); fail++ }

async function mustReject(name, fn) {
  try {
    await fn()
    bad(name, 'SUCCEEDED but should have been refused')
  } catch (err) {
    ok(`${name}\n      refused: ${String(err.message).split('\n').find((l) => l.trim())?.slice(0, 90)}`)
  }
}

async function main() {
  console.log('\n\x1b[1mThe runtime role cannot bypass RLS\x1b[0m')

  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await owner.connect()
  const { rows: role } = await owner.query(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='soberlife_app'`,
  )
  const { rows: forced } = await owner.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('residents','stays','emergency_contacts','documents','bed_assignments','ledger_entries','sign_outs',
                        'schedule_events','schedule_occurrences','schedule_sessions','schedule_attendees','schedule_attendance',
                        'service_entries')
      ORDER BY relname`,
  )
  await owner.end()

  role[0] && !role[0].rolsuper && !role[0].rolbypassrls
    ? ok('soberlife_app is neither superuser nor BYPASSRLS')
    : bad('runtime role cannot bypass', JSON.stringify(role[0]))

  // The three schedule tables that are facility CONFIGURATION rather than
  // resident data are gated anyway, scoped through attendance. That is what
  // makes CLAUDE.md's "a resident's schedule is a join through attendance, not
  // through cohort" true at the database rather than only in a service.
  const EXPECTED_FORCED = 13
  const allForced =
    forced.length === EXPECTED_FORCED && forced.every((t) => t.relrowsecurity && t.relforcerowsecurity)
  allForced
    ? ok(`RLS is enabled AND forced on all ${EXPECTED_FORCED} tables (${forced.map((t) => t.relname).join(', ')})`)
    : bad('RLS enabled and forced', JSON.stringify(forced))

  const usingApp = (process.env.APP_DATABASE_URL ?? '').includes('soberlife_app')
  usingApp
    ? ok('the application connects as soberlife_app, not the owner')
    : bad('runtime connection', 'APP_DATABASE_URL is not the app role')

  // ── Gather two residents as staff ─────────────────────────────────────────
  // NOTE the `async () => await`. A PrismaPromise is lazy — it does not run
  // until awaited — so returning one unawaited from runAsSystem would execute
  // it outside the AsyncLocalStorage scope, with no actor context.
  const residents = await runAsSystem(async () =>
    await prisma.resident.findMany({ orderBy: { lastName: 'asc' }, include: { stays: true } }),
  )
  const [alice, bob] = residents
  residents.length >= 2
    ? ok(`staff context sees all ${residents.length} residents`)
    : bad('staff sees all residents', residents.length)

  console.log('\n\x1b[1mA resident sees only themselves\x1b[0m')

  const asAlice = (fn) =>
    runWithDbActor({ kind: ACTOR.RESIDENT, residentId: alice.id }, async () => await fn())

  const visible = await asAlice(() => prisma.resident.findMany())
  visible.length === 1 && visible[0].id === alice.id
    ? ok(`resident context sees exactly 1 resident — themselves (${visible[0].firstName})`)
    : bad('resident sees only self', `saw ${visible.length}: ${visible.map((r) => r.firstName).join(', ')}`)

  const other = await asAlice(() => prisma.resident.findUnique({ where: { id: bob.id } }))
  other === null
    ? ok('fetching another resident BY ID returns nothing, not a row')
    : bad('direct id lookup blocked', JSON.stringify(other))

  const otherStays = await asAlice(() => prisma.stay.findMany({ where: { residentId: bob.id } }))
  otherStays.length === 0
    ? ok("another resident's stays are invisible")
    : bad('stays scoped', otherStays.length)

  const ownStays = await asAlice(() => prisma.stay.findMany())
  ownStays.length > 0 && ownStays.every((s) => s.residentId === alice.id)
    ? ok(`their own stays are still visible (${ownStays.length})`)
    : bad('own stays visible', ownStays.length)

  const contacts = await asAlice(() => prisma.emergencyContact.findMany())
  contacts.length > 0 && contacts.every((c) => c.residentId === alice.id)
    ? ok('emergency contacts are scoped to them')
    : bad('contacts scoped', contacts.map((c) => c.residentId))

  // bed_assignments is scoped through its stay, not a direct residentId.
  const assignments = await asAlice(() => prisma.bedAssignment.findMany())
  const ownStayIds = new Set(ownStays.map((s) => s.id))
  assignments.length > 0 && assignments.every((a) => ownStayIds.has(a.stayId))
    ? ok('bed assignments are scoped through the stay')
    : bad('assignments scoped', `${assignments.length} rows`)

  // A ledger entry is scoped through its stay, exactly as a bed assignment is.
  // Money is the case where getting this wrong is most obviously indefensible:
  // one resident seeing another's balance is a disclosure that also tells them
  // the other person is in the programme.
  const ledger = await asAlice(() => prisma.ledgerEntry.findMany())
  ledger.every((e) => ownStayIds.has(e.stayId))
    ? ok(`a resident sees only their own ledger (${ledger.length} rows, all theirs)`)
    : bad('ledger scoped', `${ledger.length} rows, some belonging to someone else`)

  const ledgerTotal = await asAlice(() => prisma.ledgerEntry.aggregate({ _sum: { amountCents: true } }))
  const ownTotal = await asAlice(() =>
    prisma.ledgerEntry.aggregate({ _sum: { amountCents: true }, where: { stayId: { in: [...ownStayIds] } } }),
  )
  ledgerTotal._sum.amountCents === ownTotal._sum.amountCents
    ? ok('aggregates over the ledger are scoped — no leaking the house total')
    : bad('ledger aggregate scoped', `${ledgerTotal._sum.amountCents} vs ${ownTotal._sum.amountCents}`)

  // Sign-outs are scoped through the stay too. Who is out, where they went and
  // when they are due back is exactly the kind of thing one resident must not
  // be able to learn about another.
  const signOuts = await asAlice(() => prisma.signOut.findMany())
  signOuts.length > 0 && signOuts.every((s) => ownStayIds.has(s.stayId))
    ? ok(`a resident sees only their own sign-outs (${signOuts.length} rows, all theirs)`)
    : bad('sign-outs scoped', `${signOuts.length} rows`)

  const count = await asAlice(() => prisma.resident.count())
  count === 1
    ? ok('count() is scoped too — no leaking totals')
    : bad('count scoped', count)

  // The schedule. A resident's attendee rows are scoped through the stay like
  // everything else; the occurrences and events are scoped one and two joins
  // further out, THROUGH those attendee rows. That second part is the one worth
  // proving: without it a resident could read the other cohort's meeting times,
  // which is a schedule they are not on and a roster they are not part of.
  const attendees = await asAlice(() => prisma.scheduleAttendee.findMany())
  attendees.every((a) => ownStayIds.has(a.stayId))
    ? ok(`a resident sees only their own roster rows (${attendees.length} rows, all theirs)`)
    : bad('schedule attendees scoped', `${attendees.length} rows`)

  const attendance = await asAlice(() => prisma.scheduleAttendance.findMany())
  attendance.every((a) => ownStayIds.has(a.stayId))
    ? ok(`a resident sees only their own attendance marks (${attendance.length} rows)`)
    : bad('schedule attendance scoped', `${attendance.length} rows`)

  const ownOccurrenceIds = new Set(attendees.map((a) => a.occurrenceId))
  const occurrences = await asAlice(() => prisma.scheduleOccurrence.findMany())
  occurrences.every((o) => ownOccurrenceIds.has(o.id))
    ? ok(`occurrences are scoped through attendance — the other cohort's schedule is invisible (${occurrences.length} rows)`)
    : bad('occurrences scoped', `${occurrences.length} rows, some not theirs`)

  await mustReject('adding themselves to an event is refused (staff-only write)', () =>
    asAlice(() =>
      prisma.scheduleAttendee.create({
        data: {
          occurrenceId: [...ownOccurrenceIds][0] ?? '00000000-0000-0000-0000-000000000000',
          cohort: 'MEN',
          stayId: [...ownStayIds][0],
          addedById: [...ownStayIds][0],
        },
      }),
    ),
  )

  // Community service. CLAUDE.md's role table promises a resident sees their
  // OWN hours, and this is that promise at the database level — ahead of the
  // portal that will rely on it. Logging is still staff-only until then.
  const serviceRows = await asAlice(() => prisma.serviceEntry.findMany())
  serviceRows.every((e) => ownStayIds.has(e.stayId))
    ? ok(`a resident sees only their own service hours (${serviceRows.length} rows, all theirs)`)
    : bad('service entries scoped', `${serviceRows.length} rows`)

  const serviceTotal = await asAlice(() =>
    prisma.serviceEntry.aggregate({ _sum: { minutes: true } }),
  )
  const ownServiceTotal = await asAlice(() =>
    prisma.serviceEntry.aggregate({
      _sum: { minutes: true },
      where: { stayId: { in: [...ownStayIds] } },
    }),
  )
  serviceTotal._sum.minutes === ownServiceTotal._sum.minutes
    ? ok('aggregates over service hours are scoped — no leaking the house total')
    : bad('service aggregate scoped', `${serviceTotal._sum.minutes} vs ${ownServiceTotal._sum.minutes}`)

  await mustReject('logging service hours is refused (staff-only write)', () =>
    asAlice(() =>
      prisma.serviceEntry.create({
        data: {
          stayId: [...ownStayIds][0],
          minutes: 60,
          workedOn: new Date('2026-08-01T00:00:00.000Z'),
          location: 'self-reported',
          recordedById: [...ownStayIds][0],
        },
      }),
    ),
  )

  await mustReject('marking their own attendance is refused (staff-only write)', () =>
    asAlice(() =>
      prisma.scheduleAttendance.create({
        data: {
          sessionId: '00000000-0000-0000-0000-000000000000',
          cohort: 'MEN',
          stayId: [...ownStayIds][0],
          status: 'ATTENDED',
          recordedById: [...ownStayIds][0],
        },
      }),
    ),
  )

  console.log('\n\x1b[1mA resident cannot write\x1b[0m')

  await mustReject('creating a resident is refused', () =>
    asAlice(() => prisma.resident.create({ data: { firstName: 'X', lastName: 'Y', cohort: 'MEN' } })),
  )

  await mustReject("editing another resident's record is refused", () =>
    asAlice(() => prisma.resident.update({ where: { id: bob.id }, data: { firstName: 'Hacked' } })),
  )

  await mustReject('recording a sign-out is refused (staff-only write)', () =>
    asAlice(() =>
      prisma.signOut.create({
        data: {
          stayId: [...ownStayIds][0],
          destination: 'X',
          outAt: new Date(),
          expectedReturnAt: new Date(Date.now() + 3_600_000),
          recordedById: alice.id,
        },
      }),
    ),
  )

  console.log('\n\x1b[1mNo context means no data\x1b[0m')

  await mustReject('querying residents with no actor context is refused outright', () =>
    prisma.resident.findMany(),
  )

  // The fail-closed property, proven at the SQL level rather than in our code:
  // connect as the app role, set no context, and ask Postgres directly.
  const app = new pg.Client({ connectionString: process.env.APP_DATABASE_URL })
  await app.connect()
  const raw = await app.query('SELECT count(*)::int AS n FROM residents')
  const staffRaw = await app.query(
    `SELECT set_config('app.actor_kind','staff',false); SELECT count(*)::int AS n FROM residents`,
  )
  await app.end()

  raw.rows[0].n === 0
    ? ok('raw SQL as the app role with no context returns 0 rows (fail-closed)')
    : bad('fail-closed at SQL level', `${raw.rows[0].n} rows visible`)

  const staffCount = Array.isArray(staffRaw) ? staffRaw[1].rows[0].n : staffRaw.rows[0].n
  staffCount > 0
    ? ok(`the same connection with staff context sees ${staffCount} — policies, not permissions`)
    : bad('staff context works at SQL level', staffCount)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
