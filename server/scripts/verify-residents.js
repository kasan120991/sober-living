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

  // Imported here rather than at module scope: importing db/client.js pulls in
  // the extensions, and the suite wants the app booted first.
  const { prisma } = await import('../src/db/client.js')

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

  console.log('\n\x1b[1mIntake detail\x1b[0m')

  const full = await manager('/residents', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Imani', lastName: 'Okafor', cohort: 'WOMEN',
      dateOfBirth: '1991-02-09', ssnLast4: '3312',
      intakeNotes: 'Arrived with two bags and a court letter.',
      sobrietyDate: '2026-05-30', email: 'i.okafor@example.com', phone: '404-555-0170',
      insurance: { provider: 'Peach State', policyNumber: 'PS99120', groupNumber: 'G4' },
      emergencyContact: { name: 'Ada Okafor', relationship: 'Aunt', phone: '404-555-0171' },
    }),
  })
  full.status === 201 ? ok('intake accepts the full form') : bad('full intake', JSON.stringify(full.body))

  const rec = await manager(`/residents/${full.body.id}`)
  rec.body?.current?.sobrietyDate && rec.body?.current?.intakeNotes
    ? ok('sobriety date and intake notes are stored on the stay')
    : bad('stay fields', JSON.stringify(rec.body?.current))
  rec.body?.insurance?.policyNumber === 'PS99120'
    ? ok('insurance is stored and returned')
    : bad('insurance', JSON.stringify(rec.body?.insurance))

  // The last four of an SSN must not reach a tech at all — omitted server-side,
  // not hidden in the client, so it never goes over the wire.
  const asManager = await manager(`/residents/${full.body.id}`)
  const asTech = await tech(`/residents/${full.body.id}`)
  asManager.body.ssnLast4 === '3312'
    ? ok('a house manager sees the last four of the SSN')
    : bad('manager sees ssn', asManager.body.ssnLast4)
  !('ssnLast4' in asTech.body) && asTech.body.canSeeSsn === false
    ? ok('a tech never receives it — the key is absent, not blanked')
    : bad('tech ssn omitted', JSON.stringify({ has: 'ssnLast4' in asTech.body }))

  const tooLong = await manager('/residents', {
    method: 'POST',
    body: JSON.stringify({ firstName: 'Reject', lastName: 'Me', cohort: 'MEN', ssnLast4: '123456789' }),
  })
  tooLong.status === 400
    ? ok('a full SSN pasted into the last-four box is refused')
    : bad('ssn length', tooLong.status)

  const ssnLeak = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM "audit_log" WHERE "entityId" LIKE '%3312%'`)
  ssnLeak[0].n === 0 ? ok('no SSN fragment reaches the audit log') : bad('ssn in audit', ssnLeak[0].n)

  console.log('\n\x1b[1mThe bell\x1b[0m')

  // Notifications are derived from current state, never stored — so the test
  // is that they track reality, not that a row was written somewhere.
  const notif = await tech('/notifications')
  notif.status === 200 && Array.isArray(notif.body?.items)
    ? ok('any staff role can read notifications')
    : bad('notifications readable', `${notif.status}`)

  // Gated on the roster rather than assumed: this suite mutates as it runs, and
  // an assertion that only holds on a freshly seeded database is a trap for
  // whoever runs it twice.
  const kinds = new Set((notif.body?.items ?? []).map((i) => i.kind))
  const rosterUnhoused = (await admin('/residents')).body.unhoused.length
  rosterUnhoused === 0 || kinds.has('UNHOUSED')
    ? ok(
        rosterUnhoused
          ? 'an unplaced resident surfaces in the bell'
          : 'nobody is unplaced, and the bell agrees',
      )
    : bad('unhoused surfaces', [...kinds].join(', ') || 'no items')

  const actionable = (notif.body?.items ?? []).filter((i) => i.level === 'action').length
  notif.body?.actionCount === actionable
    ? ok(`the badge counts only actionable items (${actionable} of ${notif.body.items.length})`)
    : bad('badge count', `${notif.body?.actionCount} vs ${actionable}`)

  const watchOnly = (notif.body?.items ?? []).filter((i) => i.level === 'watch')
  watchOnly.every((i) => i.kind === 'BED_OUT_OF_SERVICE')
    ? ok('an out-of-service bed is shown but does not inflate the badge')
    : bad('watch level', JSON.stringify(watchOnly.map((i) => i.kind)))

  // The point of deriving rather than storing is that the bell cannot drift
  // from reality. Assert exactly that: the set of unhoused notifications is the
  // set of unhoused residents, no more and no less.
  //
  // Checked by comparison rather than by placing someone in a bed — a suite
  // that mutates to prove a point cannot be run twice, and this one is run
  // between other suites.
  // Compared against the roster's own rows rather than its `unhoused` helper,
  // so this asserts the invariant itself — a flagged stay is a stay with no bed
  // — and not the behaviour of one convenience query.
  const roster = (await tech('/notifications')).body
  const rosterRows = (await admin('/residents')).body.residents
  const flagged = new Set(
    (roster.items ?? []).filter((i) => i.kind === 'UNHOUSED').map((i) => i.id.split(':')[1]),
  )
  const bedless = new Set(
    rosterRows.filter((r) => r.status === 'ACTIVE' && !r.bed).map((r) => r.stayId),
  )
  flagged.size === bedless.size && [...flagged].every((id) => bedless.has(id))
    ? ok(`the bell matches the roster exactly (${flagged.size} unplaced)`)
    : bad('bell matches roster', `flagged ${[...flagged]} vs bedless ${[...bedless]}`)

  const housedFlagged = rosterRows.filter((r) => r.bed && flagged.has(r.stayId))
  housedFlagged.length === 0
    ? ok('nobody with a bed is flagged — the item clears itself, with nothing to dismiss')
    : bad('stale notification', housedFlagged.map((r) => r.fullName).join(', '))

  console.log('\n\x1b[1mSearch and status\x1b[0m')

  const short = await manager('/search?q=a')
  short.body?.tooShort === true && !short.body.residents.length
    ? ok('a one-letter query returns nothing — it cannot be walked to enumerate the roster')
    : bad('min query length', JSON.stringify(short.body))

  const byName = await manager('/search?q=boo')
  byName.body?.residents?.[0]?.fullName === 'Tasha Boone'
    ? ok('search finds a resident by partial surname')
    : bad('search residents', JSON.stringify(byName.body?.residents))

  const fields = Object.keys(byName.body?.residents?.[0] ?? {})
  !fields.some((f) => ['dateOfBirth', 'ssnLast4', 'balanceCents', 'intakeNotes', 'phone'].includes(f))
    ? ok(`search returns roster-level fields only (${fields.join(', ')})`)
    : bad('search leaks fields', fields.join(', '))

  const byApt = await manager('/search?q=apt')
  byApt.body?.apartments?.length > 0
    ? ok(`search finds apartments (${byApt.body.apartments.length})`)
    : bad('search apartments', JSON.stringify(byApt.body))

  // The query is a name. It must not reach the audit log.
  const qLeak = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM "audit_log"
     WHERE "entity" ILIKE '%search%' OR "entityId" ILIKE '%boo%'`)
  qLeak[0].n === 0
    ? ok('the search term never reaches the audit log')
    : bad('query in audit', qLeak[0].n)

  const techSearch = await tech('/search?q=boo')
  techSearch.status === 200
    ? ok('a tech may search — they can already read the roster')
    : bad('tech search', techSearch.status)

  const status = await tech('/search/status')
  status.status === 200 && typeof status.body?.count === 'number' && status.body?.level
    ? ok(`status returns one figure (${status.body.count} ${status.body.label})`)
    : bad('status shape', JSON.stringify(status.body))

  !JSON.stringify(status.body).match(/[A-Z][a-z]+ [A-Z][a-z]+/)
    ? ok('status carries counts only, never a name')
    : bad('status has a name in it', JSON.stringify(status.body))

  console.log('\n\x1b[1mAudit\x1b[0m')

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
