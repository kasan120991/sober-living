/**
 * The dashboard — end to end through the real HTTP API.
 *
 * The landing page is one read composed from the modules' own derivations, so
 * the thing worth asserting is AGREEMENT: every queue must equal what its
 * source endpoint says, because a dashboard that disagrees with the page it
 * links to is worse than no dashboard. Plus the shape rules that carry policy —
 * staff-only, capacity per cohort with no total, the schedule in band form
 * (never a flat list on the wire), and balances derived live.
 *
 * Run after `node scripts/seed.js`. Leaves the facility as it found it: the
 * sign-out it records is deleted, and the payment it posts is small but real —
 * reseed after, like the other suites.
 */
import { createApp } from '../src/app.js'

let pass = 0
let fail = 0
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++ }
const bad = (n, d) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`); fail++ }
const PW = 'soberlife-dev-1234'

const ids = (rows, key = 'id') => JSON.stringify(rows.map((r) => r[key]).sort())

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
  const manager = as(await login('manager@facility.test'))

  console.log('\n\x1b[1mWho may read it\x1b[0m')

  const anon = await fetch(`${base}/dashboard`)
  anon.status === 401
    ? ok('unauthenticated dashboard is refused')
    : bad('anonymous blocked', anon.status)

  const r = await tech('/dashboard')
  r.status === 200
    ? ok('a tech can read the dashboard — it is all-staff, like the bell')
    : bad('tech reads dashboard', r.status)

  const d = r.body ?? {}

  console.log('\n\x1b[1mThe shape\x1b[0m')

  Array.isArray(d.signedOut) &&
  d.attention &&
  Array.isArray(d.attention.unhoused) &&
  Array.isArray(d.attention.needsRoll) &&
  Array.isArray(d.attention.urgentMaintenance) &&
  d.balances &&
  Array.isArray(d.balances.owing) &&
  d.capacity &&
  d.upcoming
    ? ok('one payload: signedOut, attention, balances, capacity, upcoming')
    : bad('payload shape', JSON.stringify(Object.keys(d)))

  d.capacity?.MEN && d.capacity?.WOMEN && d.capacity.total === undefined
    ? ok('capacity is per cohort with no combined total anywhere')
    : bad('capacity shape', JSON.stringify(d.capacity))

  const lanes = d.upcoming?.lanes ?? []
  Array.isArray(d.upcoming?.shared?.days) &&
  lanes.length === 2 &&
  lanes[0]?.cohort === 'MEN' &&
  lanes[1]?.cohort === 'WOMEN'
    ? ok('upcoming is band form — { shared, lanes: [MEN, WOMEN] }, never a flat list')
    : bad('upcoming band form', JSON.stringify({ shared: !!d.upcoming?.shared, lanes: lanes.map((l) => l?.cohort) }))

  d.upcoming?.days === undefined && !Array.isArray(d.upcoming?.sessions)
    ? ok('no flat session list rides along with the bands')
    : bad('flat list smuggled', JSON.stringify(Object.keys(d.upcoming ?? {})))

  d.upcoming?.from === d.upcoming?.to
    ? ok(`the window is one day — today's schedule only (${d.upcoming.from})`)
    : bad('one-day window', `${d.upcoming?.from} .. ${d.upcoming?.to}`)

  // Vacuously true on a day with no shared session — verify-schedule.js pins
  // the merge itself; this only guards against a flat re-merge sneaking in.
  const laneEventIds = new Set(
    lanes.flatMap((l) => l.days.flatMap((day) => day.sessions.map((s) => s.eventId))),
  )
  const sharedSessions = (d.upcoming?.shared?.days ?? []).flatMap((day) => day.sessions)
  sharedSessions.every((s) => !laneEventIds.has(s.eventId))
    ? ok(`nothing in the shared band is also in a lane (${sharedSessions.length} shared today)`)
    : bad('band disjointness', JSON.stringify(sharedSessions.map((s) => s.eventId)))

  console.log('\n\x1b[1mAgreement with the source endpoints\x1b[0m')

  const signOuts = await tech('/sign-outs')
  ids(d.signedOut) === ids(signOuts.body?.open ?? [])
    ? ok(`signedOut equals /sign-outs open (${d.signedOut.length})`)
    : bad('signedOut agreement', `${ids(d.signedOut)} vs ${ids(signOuts.body?.open ?? [])}`)

  const flagged = (rows) => JSON.stringify(rows.filter((s) => s.overdue).map((s) => s.id).sort())
  flagged(d.signedOut) === flagged(signOuts.body?.open ?? []) && d.signedOut.some((s) => s.overdue)
    ? ok('the overdue flags match, and the seeded overdue sign-out carries one')
    : bad('overdue agreement', flagged(d.signedOut))

  d.signedOut.every((s) => s.destination)
    ? ok('sign-out rows carry the destination (the bell rule: acting needs it)')
    : bad('destination missing', JSON.stringify(d.signedOut[0]))

  const census = await tech('/census')
  ids(d.attention.unhoused) === ids(census.body?.unhoused ?? [])
    ? ok(`attention.unhoused equals the census unhoused (${d.attention.unhoused.length})`)
    : bad('unhoused agreement', `${ids(d.attention.unhoused)} vs ${ids(census.body?.unhoused ?? [])}`)

  const schedule = await tech('/schedule?days=1')
  const rollKeys = (rows) => JSON.stringify(rows.map((s) => `${s.eventId}|${s.date}`).sort())
  rollKeys(d.attention.needsRoll) === rollKeys(schedule.body?.needsRoll ?? [])
    ? ok(`attention.needsRoll equals the schedule board's queue (${d.attention.needsRoll.length})`)
    : bad('needsRoll agreement', rollKeys(d.attention.needsRoll))

  const maint = await tech('/maintenance?status=open')
  const urgentOpen = (maint.body?.requests ?? maint.body ?? []).filter?.((m) => m.priority === 'URGENT') ?? []
  ids(d.attention.urgentMaintenance) === ids(urgentOpen)
    ? ok(`attention.urgentMaintenance equals open URGENT requests (${d.attention.urgentMaintenance.length})`)
    : bad('urgent agreement', `${ids(d.attention.urgentMaintenance)} vs ${ids(urgentOpen)}`)

  const capFree = d.capacity.MEN.free + d.capacity.WOMEN.free
  capFree === census.body?.figures?.free
    ? ok('per-cohort free beds sum to the census figure')
    : bad('capacity agreement', `${capFree} vs ${census.body?.figures?.free}`)

  console.log('\n\x1b[1mBalances, derived live\x1b[0m')

  const sum = d.balances.owing.reduce((t, x) => t + x.balanceCents, 0)
  sum === d.balances.totalCents
    ? ok('the card total is the sum of the rows beneath it')
    : bad('total vs rows', `${sum} vs ${d.balances.totalCents}`)

  d.balances.owing.every((x) => x.balanceCents > 0)
    ? ok('only positive balances make the list')
    : bad('non-positive row', JSON.stringify(d.balances.owing))

  const sorted = [...d.balances.owing].sort((a, b) => b.balanceCents - a.balanceCents)
  JSON.stringify(sorted) === JSON.stringify(d.balances.owing)
    ? ok('largest balance first')
    : bad('owing order', JSON.stringify(d.balances.owing.map((x) => x.balanceCents)))

  const roster = await tech('/residents')
  const rosterBalance = new Map((roster.body?.residents ?? []).map((x) => [x.id, x.balanceCents]))
  d.balances.owing.every((x) => rosterBalance.get(x.residentId) === x.balanceCents)
    ? ok('every owed figure matches the roster, which derives its own')
    : bad('roster agreement', JSON.stringify(d.balances.owing))

  if (d.balances.owing.length) {
    const top = d.balances.owing[0]
    const paid = await manager(`/residents/${top.residentId}/ledger`, {
      method: 'POST',
      body: JSON.stringify({ type: 'PAYMENT', amount: '1.00', description: 'verify-dashboard probe payment' }),
    })
    const after = await tech('/dashboard')
    paid.status === 201 || paid.status === 200
      ? after.body?.balances?.totalCents === d.balances.totalCents - 100
        ? ok('posting a payment moves the outstanding total on the next read — nothing is stored')
        : bad('live derivation', `${after.body?.balances?.totalCents} vs ${d.balances.totalCents - 100}`)
      : bad('probe payment refused', `${paid.status} ${JSON.stringify(paid.body)}`)
  }

  console.log('\n\x1b[1mA new sign-out lands on the next read\x1b[0m')

  const housed = (roster.body?.residents ?? []).find(
    (x) => x.status === 'ACTIVE' && x.bed && !d.signedOut.some((s) => s.resident.id === x.id),
  )
  if (!housed) {
    bad('finding a resident to sign out', 'nobody active, housed and not already out')
  } else {
    const created = await tech('/sign-outs', {
      method: 'POST',
      body: JSON.stringify({
        residentId: housed.id,
        destination: 'verify-dashboard probe',
        expectedReturnTime: '23:59',
      }),
    })
    const after = await tech('/dashboard')
    const seen = (after.body?.signedOut ?? []).find((s) => s.resident.id === housed.id)
    created.status === 201 && seen && !seen.overdue
      ? ok(`${housed.fullName} signed out and appears, not overdue`)
      : bad('sign-out surfaces', `${created.status} ${JSON.stringify(seen)}`)

    // Open and recorded in error is deletable by any staff — put the house back.
    const removed = await tech(`/sign-outs/${created.body?.id ?? seen?.id}`, { method: 'DELETE' })
    removed.status === 204 || removed.status === 200
      ? ok('the probe sign-out is removed again')
      : bad('probe cleanup', removed.status)
  }

  server.close()
  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
