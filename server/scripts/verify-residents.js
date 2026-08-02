/**
 * Residents — intake, bed moves, discharge — end to end through the HTTP API.
 *
 * Run after `node scripts/seed.js`. Creates residents and does not clean up, so
 * reseed afterwards.
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

  const admin = as(await login('admin@facility.test'))
  const manager = as(await login('manager@facility.test'))
  const tech = as(await login('tech@facility.test'))

  console.log('\n\x1b[1mThe roster\x1b[0m')

  const list = await admin('/residents')
  const names = (list.body?.residents ?? []).map((r) => r.fullName)
  list.status === 200 && names.length === 6
    ? ok(`lists the 6 current residents (${names.length} rows)`)
    : bad('roster lists current residents', `${names.length}: ${names.join(', ')}`)

  !names.includes('Curtis Ramsey')
    ? ok('a discharged resident is hidden by default')
    : bad('discharged hidden', 'Curtis Ramsey appeared')

  const withDischarged = await admin('/residents?includeDischarged=true')
  withDischarged.body.residents.some((r) => r.fullName === 'Curtis Ramsey')
    ? ok('…and appears with includeDischarged=true')
    : bad('discharged shown on request', 'still missing')

  const andre = list.body.residents.find((r) => r.fullName === 'Andre Whitfield')
  andre?.bed?.label === 'A' && andre.bed.apartmentName === 'Apt 12'
    ? ok(`current bed resolves (${andre.fullName} → ${andre.bed.apartmentName} ${andre.bed.label})`)
    : bad('bed resolves', JSON.stringify(andre?.bed))

  andre?.dayOfStay > 1 && andre.program?.name
    ? ok(`day of stay and program resolve (day ${andre.dayOfStay}, ${andre.program.name})`)
    : bad('day/program', JSON.stringify({ day: andre?.dayOfStay, program: andre?.program }))

  const joy = list.body.residents.find((r) => r.fullName === 'Joy Nakamura')
  joy && joy.bed === null
    ? ok('a resident awaiting a bed is listed with no bed')
    : bad('unhoused resident', JSON.stringify(joy?.bed))

  console.log('\n\x1b[1mThe record\x1b[0m')

  const detail = await admin(`/residents/${andre.id}`)
  detail.body?.emergencyContacts?.length > 0
    ? ok('the record carries emergency contacts')
    : bad('contacts on record', JSON.stringify(detail.body?.emergencyContacts))

  const curtis = withDischarged.body.residents.find((r) => r.fullName === 'Curtis Ramsey')
  const curtisDetail = await admin(`/residents/${curtis.id}`)
  const past = curtisDetail.body.stays[0]
  past?.dischargeType === 'SUCCESSFUL' && past.dischargeReason && past.beds.length === 1
    ? ok(`a past stay keeps its discharge type, reason and bed history (${past.beds[0].label})`)
    : bad('stay history', JSON.stringify(past))

  console.log('\n\x1b[1mIntake\x1b[0m')

  const beds = await admin('/residents/available-beds?cohort=WOMEN')
  const freeBed = beds.body?.beds?.[0]
  freeBed ? ok(`available beds are offered (${freeBed.label})`) : bad('available beds', JSON.stringify(beds.body))

  const techIntake = await tech('/residents', {
    method: 'POST',
    body: JSON.stringify({ firstName: 'No', lastName: 'Way', cohort: 'WOMEN' }),
  })
  techIntake.status === 403 ? ok('a tech cannot intake a resident') : bad('tech blocked', techIntake.status)

  const intake = await manager('/residents', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Nadia',
      lastName: 'Okonkwo',
      cohort: 'WOMEN',
      bedId: freeBed.id,
      referralSource: 'Hospital discharge planner',
      emergencyContact: { name: 'Ada Okonkwo', relationship: 'Sister', phone: '512-555-0177' },
    }),
  })
  intake.status === 201 ? ok('a manager can intake a resident') : bad('intake', JSON.stringify(intake.body))

  const nadia = await admin(`/residents/${intake.body.id}`)
  nadia.body?.current?.bed?.id === freeBed.id
    ? ok('intake placed them in the chosen bed, in one transaction')
    : bad('intake assigns bed', JSON.stringify(nadia.body?.current?.bed))

  nadia.body?.emergencyContacts?.length === 1
    ? ok('the emergency contact given at intake was saved')
    : bad('intake contact', JSON.stringify(nadia.body?.emergencyContacts))

  const takenAgain = await manager('/residents', {
    method: 'POST',
    body: JSON.stringify({ firstName: 'Too', lastName: 'Late', cohort: 'WOMEN', bedId: freeBed.id }),
  })
  takenAgain.status === 409
    ? ok(`intake into an occupied bed is refused — "${takenAgain.body?.error}"`)
    : bad('occupied bed at intake', takenAgain.status)

  console.log('\n\x1b[1mBeds\x1b[0m')

  const mensBeds = await admin('/residents/available-beds?cohort=MEN')
  const wrongCohort = await manager(`/residents/${nadia.body.id}/bed`, {
    method: 'POST',
    body: JSON.stringify({ bedId: mensBeds.body.beds[0]?.id }),
  })
  wrongCohort.status >= 400
    ? ok('moving a woman into a MEN bed is refused (composite FK holds through the API)')
    : bad('cohort enforced on transfer', wrongCohort.status)

  // Intake took the last free women's bed, so make another. This also proves
  // a bed created through the apartments API is immediately assignable.
  const apts = await admin('/apartments')
  const womensApt = apts.body.apartments.find((a) => a.cohort === 'WOMEN')
  await admin(`/apartments/${womensApt.id}/beds`, {
    method: 'POST',
    body: JSON.stringify({ count: 1, scheme: 'alpha' }),
  })

  const joyBeds = await admin('/residents/available-beds?cohort=WOMEN')
  const place = await manager(`/residents/${joy.id}/bed`, {
    method: 'POST',
    body: JSON.stringify({ bedId: joyBeds.body.beds[0].id }),
  })
  place.status === 200 ? ok('the unhoused resident can be given a bed') : bad('assign bed', JSON.stringify(place.body))

  const release = await manager(`/residents/${joy.id}/bed`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'moving apartments' }),
  })
  release.status === 200 ? ok('a bed can be released again') : bad('release bed', release.status)

  console.log('\n\x1b[1mDischarge\x1b[0m')

  const noReason = await manager(`/residents/${nadia.body.id}/discharge`, {
    method: 'POST',
    body: JSON.stringify({ dischargeType: 'SUCCESSFUL' }),
  })
  noReason.status === 400
    ? ok('discharge without a reason is refused')
    : bad('reason required', noReason.status)

  const bedBefore = nadia.body.current.bed.id
  const discharged = await manager(`/residents/${nadia.body.id}/discharge`, {
    method: 'POST',
    body: JSON.stringify({ dischargeType: 'AMA', dischargeReason: 'Left against advice on day 2.' }),
  })
  discharged.status === 200 ? ok('a manager can discharge with a type and reason') : bad('discharge', JSON.stringify(discharged.body))

  const freed = await admin('/residents/available-beds?cohort=WOMEN')
  freed.body.beds.some((b) => b.id === bedBefore)
    ? ok('discharge freed the bed')
    : bad('bed freed on discharge', 'bed still occupied')

  const again = await manager(`/residents/${nadia.body.id}/discharge`, {
    method: 'POST',
    body: JSON.stringify({ dischargeType: 'AMA', dischargeReason: 'again' }),
  })
  again.status === 409
    ? ok('discharging twice is refused')
    : bad('double discharge', again.status)

  const gone = await admin('/residents')
  !gone.body.residents.some((r) => r.id === nadia.body.id)
    ? ok('the discharged resident leaves the default roster')
    : bad('roster excludes discharged', 'still listed')

  console.log('\n\x1b[1mAudit\x1b[0m')

  const { prisma } = await import('../src/db/client.js')
  const counts = Object.fromEntries(
    await Promise.all(
      ['Resident', 'Stay', 'BedAssignment'].map(async (e) => [
        e,
        await prisma.auditLog.count({ where: { entity: e } }),
      ]),
    ),
  )
  Object.values(counts).every((n) => n > 0)
    ? ok(`resident writes are audited (${JSON.stringify(counts)})`)
    : bad('audited', JSON.stringify(counts))

  const leak = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM "audit_log"
     WHERE "entity" ILIKE '%Okonkwo%' OR "entityId" ILIKE '%Nadia%'`)
  leak[0].n === 0 ? ok('no resident names in audit rows') : bad('no names in audit', leak[0].n)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => { console.error(e); process.exit(1) })
