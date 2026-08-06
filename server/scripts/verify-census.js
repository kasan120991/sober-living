/**
 * The census — end to end through the real HTTP API.
 *
 * Asserts the landing page's read: derived occupancy, the figures row, the
 * three tile states (occupied, free, out of service), and that the endpoint is
 * staff-gated — the census is every housed resident by name, which is exactly
 * the disclosure 42 CFR Part 2 exists to prevent.
 *
 * Run after `node scripts/seed.js`. Does not truncate.
 */
import { createApp } from '../src/app.js'

let pass = 0
let fail = 0
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++ }
const bad = (n, d) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`); fail++ }
const PW = 'soberlife-dev-1234'

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

  console.log('\n\x1b[1mWho may read it\x1b[0m')

  const anon = await fetch(`${base}/census`)
  anon.status === 401
    ? ok('unauthenticated census is refused')
    : bad('anonymous blocked', anon.status)

  const r = await tech('/census')
  r.status === 200 && r.body?.apartments?.length === 2
    ? ok('a tech can read the census (2 apartments)')
    : bad('tech reads census', `${r.status} ${JSON.stringify(r.body?.apartments?.length)}`)

  console.log('\n\x1b[1mDerived occupancy\x1b[0m')

  const f = r.body?.figures
  f && f.beds === 7 && f.occupied === 5 && f.free === 1 && f.outOfService === 1
    ? ok('figures: 7 beds, 5 occupied, 1 free, 1 out of service')
    : bad('figures', JSON.stringify(f))

  f?.awaitingBed === 1
    ? ok('figures count the resident awaiting a bed')
    : bad('awaitingBed figure', JSON.stringify(f))

  const apt12 = r.body.apartments.find((a) => a.name === 'Apt 12')
  const apt14 = r.body.apartments.find((a) => a.name === 'Apt 14')
  apt12?.bedCount === 4 && apt12?.occupiedCount === 3 && apt12?.cohort === 'MEN'
    ? ok('Apt 12 reads 3 of 4 occupied, men')
    : bad('Apt 12 shape', JSON.stringify(apt12))

  const sumOccupied = r.body.apartments.reduce((n, a) => n + a.occupiedCount, 0)
  sumOccupied === f?.occupied
    ? ok('per-apartment counts agree with the figures row')
    : bad('count agreement', `${sumOccupied} vs ${f?.occupied}`)

  console.log('\n\x1b[1mThe three tile states\x1b[0m')

  const bedA = apt12?.beds?.find((b) => b.label === 'A')
  bedA?.resident?.fullName === 'Andre Whitfield' &&
  bedA?.resident?.programName === 'Phase 2' &&
  bedA?.since
    ? ok('an occupied bed carries its resident, program and since-date')
    : bad('occupied tile', JSON.stringify(bedA))

  const bedD = apt12?.beds?.find((b) => b.label === 'D')
  bedD?.status === 'OUT_OF_SERVICE' && !bedD?.resident && bedD?.outOfServiceNote
    ? ok(`an out-of-service bed carries its note ("${bedD.outOfServiceNote}") and no resident`)
    : bad('out-of-service tile', JSON.stringify(bedD))

  const bedC14 = apt14?.beds?.find((b) => b.label === 'C')
  bedC14?.status === 'ACTIVE' && !bedC14?.resident
    ? ok('a free bed is active with no resident')
    : bad('free tile', JSON.stringify(bedC14))

  const labels = apt12?.beds?.map((b) => b.label) ?? []
  JSON.stringify(labels) === JSON.stringify([...labels].sort())
    ? ok('beds come ordered by label')
    : bad('bed order', JSON.stringify(labels))

  console.log('\n\x1b[1mAwaiting a bed\x1b[0m')

  const joy = r.body?.unhoused?.find((u) => u.fullName === 'Joy Nakamura')
  joy
    ? ok('the unhoused resident appears on the census')
    : bad('unhoused present', JSON.stringify(r.body?.unhoused))

  joy?.freeBed?.label?.includes('C')
    ? ok(`she is paired with the free bed in her cohort (${joy.freeBed.label})`)
    : bad('freeBed suggestion', JSON.stringify(joy?.freeBed))

  server.close()
  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
