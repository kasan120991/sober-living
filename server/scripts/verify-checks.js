/**
 * Apartment checks — the hourly round, and the guards that make one evidence.
 *
 * What this proves: the board derives DUE/OVERDUE from the latest check
 * against the clock (grace included) with no stored state; a check must cover
 * the apartment's live roster exactly; a present resident needs a note, in the
 * route AND the database; a signed-out resident is accounted for by the
 * sign-out and cannot be NOT_FOUND; the bell's two items appear and clear
 * themselves; a correction is an AMENDMENT that carries the original's
 * checkedAt, cannot fork, and cannot cross apartments; both tables are
 * append-only against the app role (privilege) and a superuser (trigger),
 * asserted separately; RLS scopes lines to the resident's own stay and hides
 * headers from residents entirely; and the audit trail carries ids only.
 *
 * Run after `node scripts/seed.js`. Posts checks and does not clean up, so
 * reseed afterwards.
 */
import { createApp } from '../src/app.js'
import { prisma } from '../src/db/client.js'
import { ACTOR, runAsSystem, runWithDbActor } from '../src/lib/dbContext.js'

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

  // The owner connection, for what only a superuser can prove: that the
  // triggers and CHECKs hold against direct SQL. Raw SQL through the app
  // client cannot stand in — with no actor context RLS fail-closes, the
  // statement matches zero rows (or is refused by policy), and that looks
  // like a pass while testing nothing.
  const pg = (await import('pg')).default
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await owner.connect()

  // ── The gate ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe gate\x1b[0m')

  const anon = await fetch(`${base}/checks`)
  anon.status === 401 ? ok('anonymous is refused') : bad('anon 401', anon.status)

  const board = await tech('/checks')
  board.status === 200
    ? ok('a tech reads the board — recording rounds is all-staff work')
    : bad('tech reads board', board.status)

  // ── The board ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe board is derived\x1b[0m')

  const apts = board.body.apartments
  const mens = apts.find((a) => a.name === 'Apt 12')
  const womens = apts.find((a) => a.name === 'Apt 14')

  womens?.state === 'OVERDUE'
    ? ok('95 minutes since the last check reads OVERDUE — the hour plus grace has passed')
    : bad('womens overdue', JSON.stringify(womens))
  mens && mens.state !== 'OVERDUE'
    ? ok(`20 minutes since the last check is not overdue (${mens.state})`)
    : bad('mens not overdue', JSON.stringify(mens))
  apts[0]?.id === womens?.id
    ? ok('the most overdue apartment sorts first')
    : bad('overdue first', apts[0]?.name)

  board.body.log.some((b) => b.missing.includes('Apt 14'))
    ? ok('a skipped hour surfaces as a missed bucket — derived from absence, nothing written')
    : bad('missed bucket', JSON.stringify(board.body.log.map((b) => [b.hourKey, b.missing])))
  board.body.log.flatMap((b) => b.checks).some((c) => c.amended && c.amendmentReason)
    ? ok('an amended check carries its marker and reason into the log')
    : bad('amended marker', 'no amended row found')
  mens?.lastCheck?.accounted?.notFound === 1
    ? ok("the latest men's check carries one NOT_FOUND")
    : bad('notFound on card', JSON.stringify(mens?.lastCheck))

  const bell0 = (await tech('/notifications')).body.items
  bell0.some((i) => i.kind === 'APARTMENT_CHECK_OVERDUE' && i.title.includes('Apt 14'))
    ? ok('the bell carries the overdue apartment')
    : bad('bell overdue item', JSON.stringify(bell0.map((i) => i.kind)))
  bell0.some((i) => i.kind === 'RESIDENT_NOT_ACCOUNTED')
    ? ok('the bell carries the resident nobody could find')
    : bad('bell not-accounted item', JSON.stringify(bell0.map((i) => i.kind)))

  const dash = (await tech('/dashboard')).body
  Array.isArray(dash.attention.checksOverdue) && Array.isArray(dash.attention.notAccounted)
    ? ok('the dashboard composes both situations from the same helpers')
    : bad('dashboard attention', Object.keys(dash.attention).join(','))

  // The resident record shares the bell's derivation — asserted while the
  // seeded NOT_FOUND still stands, and again after a check clears it below.
  const allResidents = (await tech('/residents?includeDischarged=true')).body.residents
  const castilloId = allResidents.find((r) => r.lastName === 'Castillo').id
  const rec0 = (await tech(`/residents/${castilloId}`)).body
  rec0.current?.checks?.notAccounted &&
  bell0.some((i) => i.kind === 'RESIDENT_NOT_ACCOUNTED')
    ? ok('the record flags him unaccounted while the bell does — one derivation')
    : bad('record notAccounted', JSON.stringify(rec0.current?.checks))
  const sec0 = (await tech(`/residents/${castilloId}/checks`)).body
  sec0.status?.notAccounted?.checkedAt === rec0.current.checks.notAccounted.checkedAt &&
  sec0.status?.notAccounted?.apartmentName === rec0.current.checks.notAccounted.apartmentName
    ? ok("the section's hero matches the record payload exactly")
    : bad('section status matches', JSON.stringify(sec0.status))

  // ── The roster ───────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe roster\x1b[0m')

  const roster = (await tech(`/checks/roster/${mens.id}`)).body
  roster.people.length === 3
    ? ok("the men's roster is its three occupants")
    : bad('roster size', roster.people.length)
  const by = (last) => roster.people.find((p) => p.fullName.endsWith(last))
  const whitfield = by('Whitfield')
  const ocampo = by('Ocampo')
  const castillo = by('Castillo')
  ocampo?.presence.state === 'OUT'
    ? ok('an open sign-out pre-accounts its resident (state, no destination)')
    : bad('ocampo out', JSON.stringify(ocampo?.presence))
  ocampo && !('destination' in (ocampo.presence ?? {})) && !JSON.stringify(roster).includes('NA meeting')
    ? ok('the roster never carries a destination — the census-tile rule')
    : bad('no destination', JSON.stringify(ocampo))

  const noApt = await tech('/checks/roster/nope')
  noApt.status === 404 ? ok('an unknown apartment is a 404') : bad('roster 404', noApt.status)

  // ── Recording guards ─────────────────────────────────────────────────────
  console.log('\n\x1b[1mRecording refuses a half-filled or stale sheet\x1b[0m')

  const post = (lines, extra = {}) =>
    tech('/checks', { method: 'POST', body: JSON.stringify({ apartmentId: mens.id, lines, ...extra }) })
  const L = {
    whitP: { stayId: whitfield.stayId, status: 'PRESENT', note: 'Watching TV' },
    ocaOut: { stayId: ocampo.stayId, status: 'SIGNED_OUT' },
    casP: { stayId: castillo.stayId, status: 'PRESENT', note: 'In his room' },
  }

  const missing = await post([L.whitP, L.ocaOut])
  missing.status === 409
    ? ok(`a missing resident is a 409 — "${missing.body?.error}"`)
    : bad('missing 409', missing.status)
  const extra = await post([L.whitP, L.ocaOut, L.casP, { stayId: 'nope', status: 'PRESENT', note: 'x' }])
  extra.status === 409 ? ok('an unknown stay is a 409') : bad('extra 409', extra.status)
  const dupe = await post([L.whitP, L.whitP, L.ocaOut, L.casP])
  dupe.status === 400 ? ok('a duplicated resident is a 400') : bad('dupe 400', dupe.status)

  const noNote = await post([{ ...L.whitP, note: undefined }, L.ocaOut, L.casP])
  noNote.status === 400
    ? ok('PRESENT without a note is refused at the route')
    : bad('present needs note', noNote.status)
  const outNotOut = await post([{ ...L.whitP, status: 'SIGNED_OUT', note: undefined }, L.ocaOut, L.casP])
  outNotOut.status === 409
    ? ok('SIGNED_OUT with no open sign-out is refused')
    : bad('signed-out 409', outNotOut.status)
  const foundGone = await post([L.whitP, { stayId: ocampo.stayId, status: 'NOT_FOUND' }, L.casP])
  foundGone.status === 409
    ? ok('NOT_FOUND for a signed-out resident is refused — the sign-out accounts for them')
    : bad('notfound-signedout 409', foundGone.status)

  await rejects('the database itself refuses a PRESENT line with no note (CHECK)', () =>
    owner.query(
      `INSERT INTO "apartment_check_residents" ("id","checkId","stayId","status","note")
       VALUES ('verify-line-1', $1, $2, 'PRESENT', NULL)`,
      [womens.lastCheck.id, whitfield.stayId],
    ),
  )

  // ── A full check ─────────────────────────────────────────────────────────
  console.log('\n\x1b[1mA full check\x1b[0m')

  const fresh = await post([L.whitP, L.ocaOut, L.casP], { note: 'All quiet' })
  fresh.status === 201
    ? ok('a tech records the whole apartment in one request')
    : bad('record 201', `${fresh.status} ${JSON.stringify(fresh.body)}`)

  const board1 = (await tech('/checks')).body
  board1.apartments.find((a) => a.id === mens.id)?.state === 'CHECKED'
    ? ok('the apartment reads CHECKED for the current facility hour')
    : bad('checked state', JSON.stringify(board1.apartments.find((a) => a.id === mens.id)))

  const bell1 = (await tech('/notifications')).body.items
  !bell1.some((i) => i.kind === 'RESIDENT_NOT_ACCOUNTED')
    ? ok('the not-accounted item cleared itself — the new check accounts for him')
    : bad('notfound cleared', JSON.stringify(bell1.map((i) => i.kind)))

  const rec1 = (await tech(`/residents/${castilloId}`)).body
  rec1.current.checks.notAccounted === null &&
  rec1.current.checks.lastSeen?.note === 'In his room' &&
  rec1.current.checks.lastSeen?.apartmentName === 'Apt 12'
    ? ok('the record clears the same instant, and lastSeen carries the new note')
    : bad('record cleared', JSON.stringify(rec1.current.checks))

  const foundAnyway = await post([
    L.whitP,
    { stayId: ocampo.stayId, status: 'PRESENT', note: 'Came back early, in the kitchen' },
    L.casP,
  ])
  foundAnyway.status === 201
    ? ok('a signed-out resident found on site may be PRESENT — truth wins')
    : bad('present while signed out', foundAnyway.status)

  // ── The alarm ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe alarm is rolling, with grace\x1b[0m')

  const techUser = await runAsSystem(async () =>
    prisma.user.findFirst({ where: { email: 'tech@facility.test' } }),
  )
  const aged = (msAgo) =>
    runAsSystem(async () =>
      prisma.apartmentCheck.create({
        data: {
          apartmentId: womens.id,
          checkedAt: new Date(Date.now() - msAgo),
          recordedById: techUser.id,
        },
      }),
    )

  await aged(76 * MIN)
  let w = (await tech('/checks')).body.apartments.find((a) => a.id === womens.id)
  w.state === 'OVERDUE'
    ? ok('76 minutes since the last check is past the grace — still OVERDUE')
    : bad('76min overdue', w.state)

  await aged(74 * MIN)
  w = (await tech('/checks')).body.apartments.find((a) => a.id === womens.id)
  w.state === 'DUE'
    ? ok('74 minutes is inside the grace — DUE, not an alarm')
    : bad('74min due', w.state)
  !(await tech('/notifications')).body.items.some((i) => i.kind === 'APARTMENT_CHECK_OVERDUE')
    ? ok('the overdue bell item cleared itself')
    : bad('bell cleared', 'still present')

  const wRoster = (await tech(`/checks/roster/${womens.id}`)).body
  const wLines = wRoster.people.map((p) =>
    p.presence.state === 'IN'
      ? { stayId: p.stayId, status: 'PRESENT', note: 'Doing laundry' }
      : { stayId: p.stayId, status: 'SIGNED_OUT' },
  )
  const wFresh = await tech('/checks', {
    method: 'POST',
    body: JSON.stringify({ apartmentId: womens.id, lines: wLines }),
  })
  const board2 = (await tech('/checks')).body
  wFresh.status === 201 && board2.hour.checked === 2 && board2.figures.overdue === 0
    ? ok('both apartments checked this hour; the house is quiet')
    : bad('house quiet', `${wFresh.status} ${JSON.stringify(board2.figures)}`)

  // ── Amendment ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mAmendment\x1b[0m')

  const originalId = foundAnyway.body.id
  const original = (await tech(`/checks/${originalId}`)).body

  const noReason = await tech(`/checks/${originalId}/amend`, {
    method: 'POST',
    body: JSON.stringify({ lines: original.residents }),
  })
  noReason.status === 400
    ? ok('an amendment with no reason is refused — the reason IS the record')
    : bad('reason required', noReason.status)

  const shrunk = await tech(`/checks/${originalId}/amend`, {
    method: 'POST',
    body: JSON.stringify({ amendmentReason: 'test', lines: [L.whitP, L.casP] }),
  })
  shrunk.status === 409
    ? ok('an amendment cannot drop a resident — it describes the same visit')
    : bad('lines mismatch 409', shrunk.status)

  const rewriteHistory = await tech(`/checks/${originalId}/amend`, {
    method: 'POST',
    body: JSON.stringify({
      amendmentReason: 'test',
      lines: [L.whitP, { stayId: ocampo.stayId, status: 'NOT_FOUND' }, L.casP],
    }),
  })
  rewriteHistory.status === 409
    ? ok('NOT_FOUND is re-validated as of the ORIGINAL instant — he was signed out then')
    : bad('as-of validation', rewriteHistory.status)

  const amended = await tech(`/checks/${originalId}/amend`, {
    method: 'POST',
    body: JSON.stringify({
      amendmentReason: 'Wrong note on Castillo — he was in the yard.',
      lines: [L.whitP, { stayId: ocampo.stayId, status: 'PRESENT', note: 'In the kitchen' }, { ...L.casP, note: 'In the yard' }],
    }),
  })
  amended.status === 201 && amended.body.amended
    ? ok('a tech amends a check — corrections are hallway acts too')
    : bad('amend 201', `${amended.status} ${JSON.stringify(amended.body)}`)
  amended.body.checkedAt === original.checkedAt
    ? ok('the amendment carries checkedAt VERBATIM — it stays in its own hour')
    : bad('checkedAt carried', `${amended.body.checkedAt} vs ${original.checkedAt}`)

  const afterAmend = (await tech(`/checks/${originalId}`)).body
  afterAmend.superseded
    ? ok('the original survives, marked superseded — nothing was erased')
    : bad('original kept', JSON.stringify(afterAmend))
  const again = await tech(`/checks/${originalId}/amend`, {
    method: 'POST',
    body: JSON.stringify({
      amendmentReason: 'test',
      lines: [L.whitP, { stayId: ocampo.stayId, status: 'PRESENT', note: 'In the kitchen' }, L.casP],
    }),
  })
  again.status === 409
    ? ok('a second amendment of the original is refused — no forked history')
    : bad('no fork', again.status)

  // NULL-reason at the DB layer, not just zod: length(btrim(NULL)) is NULL and
  // a CHECK passes on NULL, so the constraint carries an explicit IS NOT NULL.
  // This assertion is what notices if that guard is ever "simplified" away.
  await rejects('the database refuses an amendment with a NULL reason (CHECK)', () =>
    owner.query(
      `INSERT INTO "apartment_checks" ("id","apartmentId","checkedAt","recordedById","supersedesId")
       VALUES ('verify-null-reason', $1, now(), $2, $3)`,
      [original.apartmentId, techUser.id, amended.body.id],
    ),
  )

  await rejects('even a SUPERUSER cannot point an amendment at another apartment (trigger)', () =>
    owner.query(
      `INSERT INTO "apartment_checks" ("id","apartmentId","checkedAt","recordedById","supersedesId","amendmentReason")
       VALUES ('verify-cross-apt', $1, now(), $2, $3, 'cross-apartment test')`,
      [womens.id, techUser.id, amended.body.id],
    ),
  )

  // ── Append-only, two layers ──────────────────────────────────────────────
  console.log('\n\x1b[1mAppend-only, two layers asserted separately\x1b[0m')

  // 1. The APP ROLE is refused by PRIVILEGE — REVOKE UPDATE, DELETE means the
  //    running API fails before any trigger is reached.
  // 2. A SUPERUSER is refused by the TRIGGER — it bypasses RLS even with FORCE
  //    and ignores grants, so this is the only proof against direct psql.
  // Raw SQL through the app client cannot stand in for (2): RLS fail-closes,
  // the statement matches zero rows, and that looks like a pass.
  const lineRow = await runAsSystem(async () =>
    prisma.apartmentCheckResident.findFirst({ where: { checkId: amended.body.id } }),
  )
  await runAsSystem(async () => {
    await rejects('the app role cannot UPDATE a check (privilege)', () =>
      prisma.apartmentCheck.update({ where: { id: originalId }, data: { note: 'edited' } }),
    )
    await rejects('the app role cannot DELETE a check (privilege)', () =>
      prisma.apartmentCheck.delete({ where: { id: originalId } }),
    )
    await rejects('the app role cannot UPDATE a line (privilege)', () =>
      prisma.apartmentCheckResident.update({ where: { id: lineRow.id }, data: { note: 'edited' } }),
    )
    await rejects('the app role cannot DELETE a line (privilege)', () =>
      prisma.apartmentCheckResident.delete({ where: { id: lineRow.id } }),
    )
  })

  await rejects('a SUPERUSER cannot UPDATE a check — the trigger holds', () =>
    owner.query(`UPDATE "apartment_checks" SET "note" = 'edited' WHERE id = $1`, [originalId]),
  )
  await rejects('a SUPERUSER cannot flip a line status — the trigger holds', () =>
    owner.query(`UPDATE "apartment_check_residents" SET "status" = 'PRESENT' WHERE id = $1`, [lineRow.id]),
  )
  await rejects('a SUPERUSER cannot DELETE a check — the trigger holds', () =>
    owner.query(`DELETE FROM "apartment_checks" WHERE id = $1`, [originalId]),
  )
  await rejects('a SUPERUSER cannot DELETE a line — the trigger holds', () =>
    owner.query(`DELETE FROM "apartment_check_residents" WHERE id = $1`, [lineRow.id]),
  )
  await owner.end()

  // ── The resident record ──────────────────────────────────────────────────
  console.log('\n\x1b[1mThe resident record\x1b[0m')

  const trail = (await tech(`/residents/${castilloId}/checks`)).body
  trail.hasActiveStay === true && trail.lines.length > 0
    ? ok(`an active resident has a trail (${trail.lines.length} lines)`)
    : bad('trail present', JSON.stringify({ has: trail.hasActiveStay, n: trail.lines.length }))

  const keys = trail.lines.map((l) => `${l.checkedAt}|${l.id}`)
  const sorted = [...keys].sort().reverse()
  keys.every((k, i) => k === sorted[i])
    ? ok('the trail is newest-first, pinned')
    : bad('trail order', JSON.stringify(keys))

  const fromOriginal = trail.lines.filter((l) => l.checkId === originalId)
  const fromAmendment = trail.lines.filter((l) => l.checkId === amended.body.id)
  fromOriginal.length === 0 && fromAmendment.length === 1 && fromAmendment[0].amended
    ? ok('an amended check appears once — the amendment, marked, never the original')
    : bad('amended once', JSON.stringify({ orig: fromOriginal.length, amend: fromAmendment.length }))

  const { facilityToday } = await import('../src/lib/facilityTime.js')
  const todayKey = facilityToday()
  const dated = (await tech(`/residents/${castilloId}/checks?date=${todayKey}`)).body
  dated.lines.length > 0 && dated.nextCursor === null
    ? ok(`the date filter returns one whole facility day (${dated.lines.length} lines, no cursor)`)
    : bad('date filter', JSON.stringify({ n: dated.lines.length, cursor: dated.nextCursor }))
  const nowhere = (await tech(`/residents/${castilloId}/checks?date=2020-01-01`)).body
  nowhere.lines.length === 0 && nowhere.hasActiveStay === true
    ? ok('a day with nothing is empty, not an error')
    : bad('empty day', JSON.stringify(nowhere))
  ;(await tech(`/residents/${castilloId}/checks?date=nope`)).status === 400
    ? ok('a malformed date is a 400')
    : bad('bad date 400', 'not 400')

  const p1 = (await tech(`/residents/${castilloId}/checks?limit=2`)).body
  const p2 = (
    await tech(`/residents/${castilloId}/checks?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`)
  ).body
  const p1Ids = new Set(p1.lines.map((l) => l.id))
  const joined = [...p1.lines, ...p2.lines].map((l) => `${l.checkedAt}|${l.id}`)
  p1.lines.length === 2 &&
  p1.nextCursor &&
  p2.lines.length > 0 &&
  !p2.lines.some((l) => p1Ids.has(l.id)) &&
  joined.every((k, i) => k === [...joined].sort().reverse()[i])
    ? ok('keyset pages do not overlap and concatenate in order')
    : bad('pagination', JSON.stringify({ p1: p1.lines.length, p2: p2.lines.length }))
  p2.status === null && p1.status !== null
    ? ok('the hero rides on page one only — cursor pages skip its queries')
    : bad('status on page 1 only', JSON.stringify({ p1: Boolean(p1.status), p2: p2.status }))
  ;(await tech(`/residents/${castilloId}/checks?cursor=garbage`)).status === 400
    ? ok('a malformed cursor is a 400')
    : bad('bad cursor 400', 'not 400')

  const ramseyId = allResidents.find((r) => r.lastName === 'Ramsey').id
  const gone = (await tech(`/residents/${ramseyId}/checks`)).body
  gone.hasActiveStay === false && gone.lines.length === 0 && gone.status === null
    ? ok('a discharged resident gets the no-active-stay payload, not an error')
    : bad('discharged trail', JSON.stringify(gone))
  const goneRec = (await tech(`/residents/${ramseyId}`)).body
  goneRec.current === null
    ? ok('their record still opens, with no current block to hang a dot on')
    : bad('discharged record', JSON.stringify(goneRec.current))

  // ── Row-level security ───────────────────────────────────────────────────
  console.log('\n\x1b[1mRow-level security\x1b[0m')

  const asResident = (fn) =>
    runWithDbActor({ kind: ACTOR.RESIDENT, residentId: castillo.residentId }, async () => await fn())

  const headers = await asResident(() => prisma.apartmentCheck.findMany())
  headers.length === 0
    ? ok('a resident sees NO check headers — the apartment note is not theirs to read')
    : bad('headers hidden', headers.length)

  const lines = await asResident(() => prisma.apartmentCheckResident.findMany())
  lines.length > 0 && lines.every((l) => l.stayId === castillo.stayId)
    ? ok(`a resident sees only their own lines (${lines.length} rows, all theirs)`)
    : bad('lines scoped', `${lines.length} rows`)

  // ── Audit ────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mAudit\x1b[0m')

  const audited = await runAsSystem(async () =>
    prisma.auditLog.count({ where: { entity: 'ApartmentCheck' } }),
  )
  audited > 0
    ? ok(`check reads and writes are audited (${audited} rows)`)
    : bad('audited', audited)

  const leak = await runAsSystem(async () =>
    prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "audit_log"
       WHERE "entity" IN ('ApartmentCheck','ApartmentCheckResident')
         AND ("entityId" ILIKE '%Sleep%' OR "entityId" ILIKE '%kitchen%' OR "entityId" ILIKE '%quiet%')`),
  )
  leak[0].n === 0
    ? ok('audit rows carry ids only — no notes, no activities')
    : bad('no detail in audit', leak[0].n)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => {
  console.error(e)
  process.exit(1)
})
