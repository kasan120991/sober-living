/**
 * Sign-outs — end to end through the real HTTP API.
 *
 * What this proves: the recording and return flow with wall-clock times
 * interpreted in the facility timezone; one open sign-out per stay; the
 * 15-minute grace window (past expected return but inside grace reads OUT,
 * not OVERDUE — and does not trip the pill); presence on the census carrying
 * state and times but never a destination; the pill's critical branch; the
 * bell's OVERDUE_SIGN_OUT item appearing and clearing itself on return; and
 * that completed returns are history nobody can delete.
 *
 * Run after `node scripts/seed.js`. Leaves sign-outs behind — reseed after.
 */
import { createApp } from '../src/app.js'
import { facilityToday, formatFacilityTime } from '../src/lib/facilityTime.js'

let pass = 0
let fail = 0
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++ }
const bad = (n, d) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`); fail++ }
const PW = 'soberlife-dev-1234'

const TZ = process.env.FACILITY_TIMEZONE ?? 'America/New_York'
/** Facility wall-clock date+time strings for an instant. */
function wallOf(instant) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant).map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}
const dayAfter = (dateStr) =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

async function main() {
  const server = createApp().listen(0)
  const base = `http://localhost:${server.address().port}`

  async function login(email) {
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
    const body = r.status === 204 ? null : await r.json().catch(() => null)
    return { status: r.status, body }
  }

  const tech = as(await login('tech@facility.test'))

  const roster = (await tech('/residents?includeDischarged=true')).body.residents
  const idOf = (last) => roster.find((r) => r.lastName === last)?.id

  console.log('\n\x1b[1mGates\x1b[0m')

  const anon = await fetch(`${base}/sign-outs`)
  anon.status === 401 ? ok('anonymous is refused') : bad('anon blocked', anon.status)

  const list = await tech('/sign-outs')
  list.status === 200 && Array.isArray(list.body?.open) && Array.isArray(list.body?.returned)
    ? ok('a tech can read the sign-out list')
    : bad('tech reads list', JSON.stringify(list.body))

  console.log('\n\x1b[1mSeeded shapes\x1b[0m')

  const danny = list.body.open.find((s) => s.resident.fullName === 'Danny Ocampo')
  danny && danny.overdue === false && danny.destination.includes('NA meeting')
    ? ok('Danny is out and not overdue')
    : bad('Danny out', JSON.stringify(danny))

  const tasha = list.body.open.find((s) => s.resident.fullName === 'Tasha Boone')
  tasha && tasha.overdue === true
    ? ok('Tasha is overdue')
    : bad('Tasha overdue', JSON.stringify(tasha))

  list.body.open[0]?.resident.fullName === 'Tasha Boone'
    ? ok('the open list puts the most overdue first')
    : bad('open ordering', JSON.stringify(list.body.open.map((s) => s.resident.fullName)))

  const andreReturned = list.body.returned.find((s) => s.resident.fullName === 'Andre Whitfield')
  andreReturned?.returnedAt && andreReturned?.returnAcknowledgedBy?.fullName
    ? ok('the completed round trip shows who saw the return')
    : bad('returned shape', JSON.stringify(andreReturned))

  console.log('\n\x1b[1mThe census board\x1b[0m')

  // Within-grace probe: Marisol's expected return is 5 minutes past — inside
  // the 15-minute window, so she must read OUT, and must not trip the pill.
  const out1h = wallOf(new Date(Date.now() - 3_600_000))
  const back5m = wallOf(new Date(Date.now() - 5 * 60_000))
  const marisol = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({
      residentId: idOf('Ferrer'),
      destination: 'Pharmacy run',
      outDate: out1h.date,
      outTime: out1h.time,
      expectedReturnDate: back5m.date,
      expectedReturnTime: back5m.time,
    }),
  })

  const census = (await tech('/census')).body
  const bedOf = (name) => {
    for (const a of census.apartments)
      for (const b of a.beds) if (b.resident?.fullName === name) return b
    return null
  }

  const dannyBed = bedOf('Danny Ocampo')
  dannyBed?.presence?.state === 'OUT' && dannyBed.presence.expectedReturnAt
    ? ok('an out resident reads OUT with an expected return time')
    : bad('OUT tile', JSON.stringify(dannyBed?.presence))

  bedOf('Tasha Boone')?.presence?.state === 'OVERDUE'
    ? ok('an overdue resident reads OVERDUE')
    : bad('OVERDUE tile', JSON.stringify(bedOf('Tasha Boone')?.presence))

  bedOf('Andre Whitfield')?.presence?.state === 'IN'
    ? ok('a returned resident reads IN')
    : bad('IN tile', JSON.stringify(bedOf('Andre Whitfield')?.presence))

  bedOf('Marisol Ferrer')?.presence?.state === 'OUT'
    ? ok('past expected return but inside the grace window still reads OUT')
    : bad('grace window', JSON.stringify(bedOf('Marisol Ferrer')?.presence))

  const anyDestination = census.apartments.some((a) =>
    a.beds.some((b) => b.presence && 'destination' in b.presence),
  )
  !anyDestination
    ? ok('presence carries no destination — where someone went is not for the board')
    : bad('presence discloses destination', 'destination key found')

  const tileOut = census.apartments.flatMap((a) => a.beds).filter((b) => b.presence?.state === 'OUT').length
  const tileOverdue = census.apartments.flatMap((a) => a.beds).filter((b) => b.presence?.state === 'OVERDUE').length
  census.figures.out === tileOut && census.figures.overdue === tileOverdue
    ? ok(`figures agree with the tiles (${tileOut} out, ${tileOverdue} overdue)`)
    : bad('figures agreement', JSON.stringify(census.figures))

  const pill = (await tech('/search/status')).body
  pill.level === 'critical' && pill.count === 1 && pill.label === 'overdue'
    ? ok('the pill goes critical with the overdue count — and grace does not count')
    : bad('pill critical', JSON.stringify(pill))

  const bell = (await tech('/notifications')).body
  const bellItem = bell.situations.find((i) => i.kind === 'OVERDUE_SIGN_OUT')
  bellItem &&
  bellItem.level === 'action' &&
  // The two are a different question and must not collapse: `level` says
  // somebody has to act, `severity` says a clock has run out. The sidebar
  // badge's red keys on this one.
  bellItem.severity === 'critical' &&
  bellItem.to === '/sign-outs' &&
  bellItem.title.includes('Tasha Boone') &&
  bellItem.detail.includes('Kroger')
    ? ok('the bell carries the overdue return, with where to start looking')
    : bad('bell item', JSON.stringify(bellItem))

  bell.actionCount === bell.situations.filter((i) => i.level === 'action').length
    ? ok('the badge counts the actionable items')
    : bad('actionCount', JSON.stringify(bell))

  console.log('\n\x1b[1mRecording\x1b[0m')

  const tomorrow = dayAfter(facilityToday())
  const ruben = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({
      residentId: idOf('Castillo'),
      destination: 'Job interview — Midtown',
      purpose: 'Second interview',
      expectedReturnDate: tomorrow,
      expectedReturnTime: '17:30',
    }),
  })
  ruben.status === 201 &&
  !Number.isNaN(Date.parse(ruben.body.outAt)) &&
  !Number.isNaN(Date.parse(ruben.body.expectedReturnAt))
    ? ok('a tech records a sign-out; times come back as UTC instants')
    : bad('record sign-out', `${ruben.status} ${JSON.stringify(ruben.body)}`)

  formatFacilityTime(ruben.body.expectedReturnAt) === '5:30 PM'
    ? ok('17:30 on the facility clock round-trips as 5:30 PM in the facility timezone')
    : bad('timezone round-trip', formatFacilityTime(ruben.body.expectedReturnAt))

  const doubleOpen = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({
      residentId: idOf('Castillo'),
      destination: 'Somewhere else',
      expectedReturnTime: '23:59',
      expectedReturnDate: tomorrow,
    }),
  })
  doubleOpen.status === 409 && /already signed out/i.test(doubleOpen.body?.error ?? '')
    ? ok(`a second open sign-out is refused — "${doubleOpen.body.error}"`)
    : bad('double open', `${doubleOpen.status} ${JSON.stringify(doubleOpen.body)}`)

  const blankDest = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({ residentId: idOf('Ocampo'), destination: '   ', expectedReturnTime: '23:00' }),
  })
  blankDest.status === 400 ? ok('a blank destination is refused') : bad('blank destination', blankDest.status)

  const badTime = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({ residentId: idOf('Ocampo'), destination: 'X', expectedReturnTime: '25:99' }),
  })
  badTime.status === 400 ? ok('a malformed time is refused') : bad('bad time', badTime.status)

  const backwards = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({
      residentId: idOf('Nakamura'),
      destination: 'X',
      outDate: tomorrow,
      outTime: '10:00',
      expectedReturnDate: tomorrow,
      expectedReturnTime: '09:00',
    }),
  })
  backwards.status === 400
    ? ok('an expected return before the out time is refused')
    : bad('backwards times', backwards.status)

  const ghost = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({ residentId: 'no-such-id', destination: 'X', expectedReturnTime: '23:00' }),
  })
  ghost.status === 409 ? ok('an unknown resident is refused') : bad('unknown resident', ghost.status)

  const discharged = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({ residentId: idOf('Ramsey'), destination: 'X', expectedReturnTime: '23:00' }),
  })
  discharged.status === 409 && /not currently in the program/i.test(discharged.body?.error ?? '')
    ? ok('a discharged resident cannot be signed out')
    : bad('discharged refused', `${discharged.status} ${JSON.stringify(discharged.body)}`)

  const joy = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({
      residentId: idOf('Nakamura'),
      destination: 'DMV',
      expectedReturnDate: tomorrow,
      expectedReturnTime: '12:00',
    }),
  })
  joy.status === 201
    ? ok('an active resident without a bed can still sign out (the stay is the requirement)')
    : bad('unhoused sign-out', `${joy.status} ${JSON.stringify(joy.body)}`)

  console.log('\n\x1b[1mReturns\x1b[0m')

  const yesterday = wallOf(new Date(Date.now() - 86_400_000))
  const badReturn = await tech(`/sign-outs/${joy.body.id}/return`, {
    method: 'POST',
    body: JSON.stringify({ returnedDate: yesterday.date, returnedTime: yesterday.time }),
  })
  badReturn.status === 400
    ? ok('a return before the out time is refused')
    : bad('return before out', badReturn.status)

  const joyGone = await tech(`/sign-outs/${joy.body.id}`, { method: 'DELETE' })
  joyGone.status === 204
    ? ok('an open sign-out recorded in error can be removed by any staff')
    : bad('open delete', joyGone.status)

  const marisolGone = await tech(`/sign-outs/${marisol.body.id}`, { method: 'DELETE' })
  marisolGone.status === 204
    ? ok('removing the within-grace probe frees its slot')
    : bad('probe delete', marisolGone.status)

  const rubenBack = await tech(`/sign-outs/${ruben.body.id}/return`, { method: 'POST', body: '{}' })
  rubenBack.status === 200 &&
  rubenBack.body.returnedAt &&
  rubenBack.body.returnAcknowledgedBy?.fullName === 'Priya Nair'
    ? ok('acknowledging a return records when and who saw it')
    : bad('acknowledge return', `${rubenBack.status} ${JSON.stringify(rubenBack.body)}`)

  const doubleBack = await tech(`/sign-outs/${ruben.body.id}/return`, { method: 'POST', body: '{}' })
  doubleBack.status === 409
    ? ok('acknowledging twice is refused')
    : bad('double return', doubleBack.status)

  const rubenAgain = await tech('/sign-outs', {
    method: 'POST',
    body: JSON.stringify({
      residentId: idOf('Castillo'),
      destination: 'Gym',
      expectedReturnDate: tomorrow,
      expectedReturnTime: '20:00',
    }),
  })
  rubenAgain.status === 201
    ? ok('a new sign-out after a completed return is allowed (the slot freed)')
    : bad('re-sign-out', `${rubenAgain.status} ${JSON.stringify(rubenAgain.body)}`)

  const delReturned = await tech(`/sign-outs/${ruben.body.id}`, { method: 'DELETE' })
  delReturned.status === 409
    ? ok(`a completed return cannot be deleted — "${delReturned.body?.error}"`)
    : bad('returned delete refused', delReturned.status)

  console.log('\n\x1b[1mThe alarm clears itself\x1b[0m')

  const tashaBack = await tech(`/sign-outs/${tasha.id}/return`, { method: 'POST', body: '{}' })
  const bellAfter = (await tech('/notifications')).body
  tashaBack.status === 200 && !bellAfter.situations.some((i) => i.kind === 'OVERDUE_SIGN_OUT')
    ? ok('the bell item vanishes the moment the return is acknowledged — derived, not dismissed')
    : bad('bell clears', JSON.stringify(bellAfter.situations.map((i) => i.kind)))

  const pillAfter = (await tech('/search/status')).body
  pillAfter.level !== 'critical'
    ? ok('the pill steps down once nobody is overdue')
    : bad('pill steps down', JSON.stringify(pillAfter))

  console.log('\n\x1b[1mAudit\x1b[0m')

  const { prisma } = await import('../src/db/client.js')
  const audited = await prisma.auditLog.count({ where: { entity: 'SignOut' } })
  audited > 0
    ? ok(`sign-out reads and writes are audited (${audited} rows)`)
    : bad('audited', audited)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
