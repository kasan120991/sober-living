/**
 * Apartments, beds and maintenance — end to end through the real HTTP API.
 *
 * These assert the rules the DATABASE cannot enforce, which is why they live in
 * route/service code and therefore need testing: occupancy blocking deletes,
 * label collisions, the admin/manager field split, and the resolution-note
 * requirement.
 *
 * Run after `node scripts/seed.js`. Does not truncate.
 */
import { createApp } from '../src/app.js'
import { runAsSystem } from '../src/lib/dbContext.js'

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

  const admin = as(await login('admin@facility.test'))
  const manager = as(await login('manager@facility.test'))
  const tech = as(await login('tech@facility.test'))

  console.log('\n\x1b[1mReading\x1b[0m')

  const list = await admin('/apartments')
  const apt12 = list.body?.apartments?.find((a) => a.name === 'Apt 12')
  list.status === 200 && list.body.apartments.length === 2
    ? ok('staff can list apartments')
    : bad('list apartments', JSON.stringify(list.body))

  apt12 && apt12.bedCount === 4 && apt12.occupiedCount === 3 && apt12.outOfServiceCount === 1
    ? ok('occupancy is derived correctly (Apt 12: 4 beds, 3 occupied, 1 out of service)')
    : bad('derived occupancy', JSON.stringify(apt12))

  const detail = await admin(`/apartments/${apt12.id}`)
  const occupiedBed = detail.body?.beds?.find((b) => b.occupied)
  const oosBed = detail.body?.beds?.find((b) => b.status === 'OUT_OF_SERVICE')
  occupiedBed?.resident?.fullName
    ? ok(`detail resolves the current resident (${occupiedBed.label} → ${occupiedBed.resident.fullName})`)
    : bad('detail resolves resident', JSON.stringify(detail.body?.beds?.[0]))

  detail.body?.maintenanceRequests?.length === 2 && detail.body.openRequestCount === 1
    ? ok('apartment detail carries its maintenance requests (2 total, 1 open)')
    : bad('maintenance on detail', JSON.stringify(detail.body?.openRequestCount))

  console.log('\n\x1b[1mWho may change what\x1b[0m')

  const techCreate = await admin('/apartments')
  const techTry = await tech('/apartments', {
    method: 'POST',
    body: JSON.stringify({ name: 'Nope', cohort: 'MEN' }),
  })
  techTry.status === 403 ? ok('a tech cannot create an apartment') : bad('tech blocked', techTry.status)

  const mgrTry = await manager('/apartments', {
    method: 'POST',
    body: JSON.stringify({ name: 'Nope', cohort: 'MEN' }),
  })
  mgrTry.status === 403
    ? ok('a house manager cannot create an apartment')
    : bad('manager blocked from create', mgrTry.status)

  const mgrStatus = await manager(`/beds/${oosBed.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'OUT_OF_SERVICE', outOfServiceNote: 'Latch still broken' }),
  })
  mgrStatus.status === 200
    ? ok('a house manager CAN mark a bed out of service')
    : bad('manager can set bed status', JSON.stringify(mgrStatus.body))

  const mgrLabel = await manager(`/beds/${oosBed.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ label: 'Z' }),
  })
  mgrLabel.status === 403
    ? ok('a house manager CANNOT rename a bed (field-level split holds)')
    : bad('manager blocked from label', `${mgrLabel.status} ${JSON.stringify(mgrLabel.body)}`)

  const adminLabel = await admin(`/beds/${oosBed.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ label: 'D' }),
  })
  adminLabel.status === 200 ? ok('an admin CAN rename a bed') : bad('admin can rename', adminLabel.status)

  console.log('\n\x1b[1mRules the database cannot enforce\x1b[0m')

  const delOccupied = await admin(`/beds/${occupiedBed.id}`, { method: 'DELETE' })
  delOccupied.status === 409
    ? ok(`deleting an occupied bed is refused — "${delOccupied.body?.error}"`)
    : bad('occupied bed delete refused', delOccupied.status)

  const delApt = await admin(`/apartments/${apt12.id}`, { method: 'DELETE' })
  delApt.status === 409
    ? ok(`deleting an apartment with beds is refused — "${delApt.body?.error}"`)
    : bad('apartment with beds delete refused', delApt.status)

  const collide = await admin(`/apartments/${apt12.id}/beds`, {
    method: 'POST',
    body: JSON.stringify({ label: 'A' }),
  })
  collide.status === 409
    ? ok('a duplicate bed label in the same apartment is refused')
    : bad('label collision refused', collide.status)

  console.log('\n\x1b[1mBed creation\x1b[0m')

  const fresh = await admin('/apartments', {
    method: 'POST',
    body: JSON.stringify({ name: `Apt Test ${Date.now() % 100000}`, cohort: 'WOMEN' }),
  })
  fresh.status === 201 ? ok('an admin can create an apartment') : bad('create apartment', JSON.stringify(fresh.body))

  const bulk = await admin(`/apartments/${fresh.body.id}/beds`, {
    method: 'POST',
    body: JSON.stringify({ count: 4, scheme: 'alpha' }),
  })
  const labels = bulk.body?.beds?.map((b) => b.label).join('')
  labels === 'ABCD' ? ok('bulk creation labels beds A–D') : bad('bulk labels', labels)

  const more = await admin(`/apartments/${fresh.body.id}/beds`, {
    method: 'POST',
    body: JSON.stringify({ count: 2, scheme: 'alpha' }),
  })
  const moreLabels = more.body?.beds?.map((b) => b.label).join('')
  moreLabels === 'EF'
    ? ok('adding 2 more continues at E–F rather than restarting at A')
    : bad('bulk continues from last label', moreLabels)

  const single = await admin(`/apartments/${fresh.body.id}/beds`, {
    method: 'POST',
    body: JSON.stringify({ label: 'Z' }),
  })
  single.status === 201 && single.body.beds[0].label === 'Z'
    ? ok('a single bed can be added with an explicit label')
    : bad('single bed creation', JSON.stringify(single.body))

  const inherited = single.body.beds[0].cohort
  inherited === 'WOMEN'
    ? ok("a new bed inherits its apartment's cohort (composite FK holds)")
    : bad('bed inherits cohort', inherited)

  console.log('\n\x1b[1mMaintenance\x1b[0m')

  const filed = await tech('/maintenance', {
    method: 'POST',
    body: JSON.stringify({ apartmentId: apt12.id, title: 'Smoke detector chirping', priority: 'NORMAL' }),
  })
  filed.status === 201
    ? ok('any staff can file a request (a tech filed one)')
    : bad('tech can file', JSON.stringify(filed.body))

  const techClose = await tech(`/maintenance/${filed.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'RESOLVED', resolutionNote: 'Changed the battery' }),
  })
  techClose.status === 403
    ? ok('a tech cannot close a request')
    : bad('tech blocked from closing', techClose.status)

  const noNote = await manager(`/maintenance/${filed.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'RESOLVED' }),
  })
  noNote.status === 400
    ? ok(`closing without a resolution note is refused — "${noNote.body?.error}"`)
    : bad('resolution note required', noNote.status)

  const closed = await manager(`/maintenance/${filed.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'RESOLVED', resolutionNote: 'Replaced the 9V battery.' }),
  })
  closed.status === 200 && closed.body.resolvedBy?.fullName && closed.body.resolvedAt
    ? ok(`a manager can close it with a note, and the closer is recorded (${closed.body.resolvedBy.fullName})`)
    : bad('manager closes with note', JSON.stringify(closed.body))

  const openOnly = await manager('/maintenance?status=open')
  const hasClosed = openOnly.body?.requests?.some((r) => r.status === 'RESOLVED')
  openOnly.status === 200 && !hasClosed
    ? ok('the open filter excludes resolved requests')
    : bad('open filter', JSON.stringify(openOnly.body?.requests?.map((r) => r.status)))

  console.log('\n\x1b[1mRemoved and restored\x1b[0m')

  // The full arc: create → bed → remove bed → remove apartment → restore.
  const rstName = `Apt Rst ${Date.now() % 100000}`
  const rst = await admin('/apartments', {
    method: 'POST',
    body: JSON.stringify({ name: rstName, cohort: 'MEN' }),
  })
  await admin(`/apartments/${rst.body.id}/beds`, {
    method: 'POST',
    body: JSON.stringify({ label: 'A' }),
  })
  const rstBed = (await admin(`/apartments/${rst.body.id}`)).body.beds[0]
  await admin(`/beds/${rstBed.id}`, { method: 'DELETE' })
  const rstDel = await admin(`/apartments/${rst.body.id}`, { method: 'DELETE' })
  rstDel.status === 204 || rstDel.status === 200
    ? ok('an apartment with no live beds can be removed')
    : bad('remove apartment', rstDel.status)

  const techRemoved = await tech('/apartments/removed')
  techRemoved.status === 403
    ? ok('a tech cannot see removed apartments')
    : bad('tech blocked from /removed', techRemoved.status)

  const mgrRemoved = await manager('/apartments/removed')
  mgrRemoved.status === 403
    ? ok('a house manager cannot see removed apartments')
    : bad('manager blocked from /removed', mgrRemoved.status)

  const removedList = await admin('/apartments/removed')
  const rstRow = removedList.body?.apartments?.find((a) => a.id === rst.body.id)
  rstRow && rstRow.bedCount === 1
    ? ok('the removed list carries the apartment and the bed it held')
    : bad('removed list', JSON.stringify(removedList.body))

  const nameHeld = await admin('/apartments', {
    method: 'POST',
    body: JSON.stringify({ name: rstName, cohort: 'MEN' }),
  })
  nameHeld.status === 409 && /restore/i.test(nameHeld.body?.error ?? '')
    ? ok(`re-creating a removed name points at restore — "${nameHeld.body.error}"`)
    : bad('removed name suggests restore', JSON.stringify(nameHeld.body))

  const mgrRestore = await manager(`/apartments/${rst.body.id}/restore`, { method: 'POST' })
  mgrRestore.status === 403
    ? ok('a house manager cannot restore')
    : bad('manager blocked from restore', mgrRestore.status)

  const restored = await admin(`/apartments/${rst.body.id}/restore`, { method: 'POST' })
  const backList = await admin('/apartments')
  const back = backList.body?.apartments?.find((a) => a.id === rst.body.id)
  restored.status === 200 && back && back.bedCount === 1
    ? ok('an admin restores it, and its bed comes back with it')
    : bad('restore', `${restored.status} ${JSON.stringify(back)}`)

  const notRemoved = await admin(`/apartments/${rst.body.id}/restore`, { method: 'POST' })
  notRemoved.status === 404
    ? ok('restoring an apartment that is not removed is refused')
    : bad('restore live apartment refused', notRemoved.status)

  console.log('\n\x1b[1mAudit\x1b[0m')

  const { prisma } = await import('../src/db/client.js')
  const counts = Object.fromEntries(
    await Promise.all(
      ['Apartment', 'Bed', 'MaintenanceRequest'].map(async (e) => [
        e,
        await prisma.auditLog.count({ where: { entity: e } }),
      ]),
    ),
  )
  Object.values(counts).every((n) => n > 0)
    ? ok(`facility config writes are audited (${JSON.stringify(counts)})`)
    : bad('config audited', JSON.stringify(counts))

  // The audit table is read by people not cleared for the underlying records.
  const leak = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM "audit_log"
     WHERE "entity" IN ('Apartment','Bed','MaintenanceRequest')
       AND ("userAgent" ILIKE '%latch%' OR "entity" ILIKE '%Apt%')`)
  leak[0].n === 0 ? ok('audit rows carry no note or name text') : bad('no PHI in audit', leak[0].n)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => { console.error(e); process.exit(1) })
