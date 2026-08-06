/**
 * Community service — the pace rule, and the guards that make an hour evidence.
 *
 * What this proves: only VERIFIED hours count; the table is immutable apart
 * from one write-once verification transition, enforced against raw SQL and not
 * just against Prisma; a correction is an AMENDMENT that leaves the original
 * untouched and cannot fork; the total is derived and stored nowhere; the quota
 * accrues in whole months, is capped at the target, and gives the first month
 * as grace; and a tech may log and verify but not set an obligation.
 *
 * Run after `node scripts/seed.js`. Posts entries and does not clean up, so
 * reseed afterwards.
 */
import { createApp } from '../src/app.js'
import { prisma } from '../src/db/client.js'
import { runAsSystem } from '../src/lib/dbContext.js'
import { servicePace } from '../src/services/communityService.js'

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

  const manager = as(await login('manager@facility.test'))
  const tech = as(await login('tech@facility.test'))

  const rows = (await manager('/residents')).body.residents
  const find = (last) => rows.find((r) => r.lastName === last)
  const andre = find('Whitfield')
  const ruben = find('Castillo')
  const danny = find('Ocampo')
  const today = new Date().toISOString().slice(0, 10)

  const summaryOf = async (id) => (await manager(`/residents/${id}`)).body.current.service

  // ── The pace rule, without a database ───────────────────────────────────
  console.log('\n\x1b[1mThe pace rule\x1b[0m')

  const pace = (d, r, v) => servicePace({ dayOfStay: d, requiredHours: r, verifiedMinutes: v })

  !pace(1, 40, 0).behind
    ? ok('nobody is behind on their intake day')
    : bad('day 1 clean', JSON.stringify(pace(1, 40, 0)))

  !pace(30, 40, 0).behind && pace(31, 40, 0).behind
    ? ok('the first month is grace — the quota falls due on day 31, not day 2')
    : bad('first month grace', `${JSON.stringify(pace(30, 40, 0))} / ${JSON.stringify(pace(31, 40, 0))}`)

  pace(31, 40, 0).expectedMinutes === 20 * 60
    ? ok('one whole month elapsed expects exactly one month of quota')
    : bad('monthly step', pace(31, 40, 0).expectedMinutes)

  pace(200, 40, 40 * 60).expectedMinutes === 40 * 60 && !pace(200, 40, 40 * 60).behind
    ? ok('expectation is CAPPED at the target — a finished resident never lights')
    : bad('capped at target', JSON.stringify(pace(200, 40, 40 * 60)))

  pace(200, null, 0).requiredMinutes === null && !pace(200, null, 0).behind
    ? ok('no target means no expectation and no dot')
    : bad('no target', JSON.stringify(pace(200, null, 0)))

  // ── Only verified hours count ───────────────────────────────────────────
  console.log('\n\x1b[1mOnly verified hours count\x1b[0m')

  const before = await summaryOf(danny.id)
  const logged = await tech(`/residents/${danny.id}/service`, {
    method: 'POST',
    body: JSON.stringify({ hours: 3.5, workedOn: today, location: 'Food bank', supervisorName: 'Rita Mbeki' }),
  })
  logged.status === 201
    ? ok('a TECH can log hours — the person handed the slip is the one at the door')
    : bad('tech logs hours', `${logged.status} ${JSON.stringify(logged.body)}`)

  const afterLog = await summaryOf(danny.id)
  afterLog.pendingMinutes === before.pendingMinutes + 210 &&
  afterLog.verifiedMinutes === before.verifiedMinutes
    ? ok('a fresh entry lands PENDING and does not move the verified total')
    : bad('pending not counted', JSON.stringify(afterLog))

  const entryId = logged.body.id
  const verified = await tech(`/service/${entryId}/verify`, { method: 'POST' })
  verified.status === 200 && verified.body.verifiedBy?.fullName
    ? ok(`a TECH can verify, and the entry records who did (${verified.body.verifiedBy.fullName})`)
    : bad('tech verifies', `${verified.status} ${JSON.stringify(verified.body)}`)

  const afterVerify = await summaryOf(danny.id)
  afterVerify.verifiedMinutes === before.verifiedMinutes + 210 &&
  afterVerify.pendingMinutes === before.pendingMinutes
    ? ok('verifying moves the hours from pending into the verified total')
    : bad('verified counted', JSON.stringify(afterVerify))

  // 3.5 h at 20 h/month against a 20 h target: still short, so still amber.
  afterVerify.behind === true && afterVerify.behindMinutes === 20 * 60 - 210
  ? ok(`the amber flag is derived, not stored (behind ${afterVerify.behindMinutes / 60} h)`)
    : bad('behind derived', JSON.stringify(afterVerify))

  // ── Immutability ────────────────────────────────────────────────────────
  console.log('\n\x1b[1mImmutable apart from one transition\x1b[0m')

  // Two independent layers, asserted separately, because they fail differently
  // and a test that conflates them proves neither:
  //
  //   1. The APP ROLE is refused by PRIVILEGE. `REVOKE UPDATE` plus a
  //      column-level grant on the verification pair means the running API
  //      cannot touch anything else — it fails before a trigger is reached.
  //   2. A SUPERUSER is refused by the TRIGGER. A superuser bypasses RLS even
  //      with FORCE and ignores grants, so this is the only way to prove the
  //      claim that the rule holds against a direct psql session.
  //
  // Note raw SQL through the app client cannot be used for (2): raw queries do
  // not carry the actor context, so RLS fail-closes and the statement matches
  // zero rows — which looks like a pass and tests nothing.
  await runAsSystem(async () => {
    await rejects('the app role cannot UPDATE minutes (privilege)', () =>
      prisma.serviceEntry.update({ where: { id: entryId }, data: { minutes: 1 } }),
    )
    await rejects('the app role cannot UPDATE location (privilege)', () =>
      prisma.serviceEntry.update({ where: { id: entryId }, data: { location: 'elsewhere' } }),
    )
    await rejects('the app role cannot DELETE (privilege)', () =>
      prisma.serviceEntry.delete({ where: { id: entryId } }),
    )
  })

  const pg = (await import('pg')).default
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await owner.connect()
  const asOwner = (sql, params) => owner.query(sql, params)

  await rejects('a SUPERUSER cannot UPDATE minutes — the trigger holds', () =>
    asOwner(`UPDATE "service_entries" SET "minutes" = 1 WHERE id = $1`, [entryId]),
  )
  // The whole-row rule means a column nobody thought about is immutable by
  // DEFAULT. `note` appears in no whitelist — it is covered because the rule is
  // a comparison, not a list, which is the property that survives a schema
  // change six months from now.
  await rejects('a column in no whitelist (note) is immutable by default', () =>
    asOwner(`UPDATE "service_entries" SET "note" = 'edited' WHERE id = $1`, [entryId]),
  )
  await rejects('a SUPERUSER cannot DELETE — the trigger holds', () =>
    asOwner(`DELETE FROM "service_entries" WHERE id = $1`, [entryId]),
  )
  await rejects('re-verifying an already verified entry is refused', () =>
    asOwner(`UPDATE "service_entries" SET "verifiedAt" = now() WHERE id = $1`, [entryId]),
  )
  await rejects('un-verifying is refused — an attestation is not erasable', () =>
    asOwner(
      `UPDATE "service_entries" SET "verifiedAt" = NULL, "verifiedById" = NULL WHERE id = $1`,
      [entryId],
    ),
  )

  // Issue #1: the constraint used to PASS here. length(btrim(NULL)) is NULL, so
  // the second branch went NULL, FALSE OR NULL is NULL, and a CHECK only rejects
  // on FALSE. The route has always required a reason — this asserts the database
  // does too, which is the standard an append-only record is held to.
  await rejects('a NULL amendment reason is refused by the DATABASE, not just the route', () =>
    asOwner(
      `INSERT INTO "service_entries"
         ("id","stayId","minutes","workedOn","location","recordedById","supersedesId")
       SELECT 'verify-null-reason', "stayId", 60, CURRENT_DATE, 'Nowhere', "recordedById", "id"
         FROM "service_entries" WHERE "id" = $1`,
      [entryId],
    ),
  )
  await owner.end()

  const reVerify = await tech(`/service/${entryId}/verify`, { method: 'POST' })
  reVerify.status === 409
    ? ok(`the API says so first — "${reVerify.body?.error}"`)
    : bad('re-verify 409', reVerify.status)

  // ── Amendment ───────────────────────────────────────────────────────────
  console.log('\n\x1b[1mAmendment\x1b[0m')

  const noReason = await tech(`/service/${entryId}/amend`, {
    method: 'POST',
    body: JSON.stringify({ hours: 2 }),
  })
  noReason.status === 400
    ? ok('an amendment with no reason is refused — the reason IS the record')
    : bad('reason required', noReason.status)

  const amended = await tech(`/service/${entryId}/amend`, {
    method: 'POST',
    body: JSON.stringify({ hours: 2, amendmentReason: "Supervisor's sheet says 2." }),
  })
  amended.status === 201 && amended.body.supersedes?.id === entryId
    ? ok('an amendment is a NEW row pointing at the original')
    : bad('amendment created', `${amended.status} ${JSON.stringify(amended.body)}`)

  const original = await runAsSystem(async () =>
    prisma.serviceEntry.findUnique({ where: { id: entryId } }),
  )
  original.minutes === 210 && original.verifiedAt
    ? ok('the original is untouched — a pure INSERT, no UPDATE anywhere')
    : bad('original untouched', JSON.stringify(original))

  const afterAmend = await summaryOf(danny.id)
  afterAmend.verifiedMinutes === before.verifiedMinutes && afterAmend.pendingMinutes === 120
    ? ok('only the amendment counts, and it starts UNVERIFIED')
    : bad('amendment supersedes', JSON.stringify(afterAmend))

  const listed = (await tech(`/residents/${danny.id}/service`)).body.entries
  !listed.some((e) => e.id === entryId) && listed.some((e) => e.id === amended.body.id)
    ? ok('the superseded original drops out of the current view')
    : bad('current view', JSON.stringify(listed.map((e) => e.id)))

  const doubleAmend = await tech(`/service/${entryId}/amend`, {
    method: 'POST',
    body: JSON.stringify({ hours: 1, amendmentReason: 'again' }),
  })
  doubleAmend.status === 409
    ? ok('amending the same entry twice is refused — no forked chain')
    : bad('fork refused via API', doubleAmend.status)

  await runAsSystem(async () => {
    await rejects('and the unique index refuses a fork with the API bypassed', () =>
      prisma.serviceEntry.create({
        data: {
          stayId: danny.stayId, minutes: 60,
          workedOn: new Date(`${today}T00:00:00.000Z`), location: 'x',
          recordedById: original.recordedById, supersedesId: entryId,
          amendmentReason: 'direct',
        },
      }),
    )
    await rejects("an amendment cannot point at another resident's entry", () =>
      prisma.serviceEntry.create({
        data: {
          stayId: ruben.stayId, minutes: 60,
          workedOn: new Date(`${today}T00:00:00.000Z`), location: 'x',
          recordedById: original.recordedById,
          supersedesId: amended.body.id, amendmentReason: 'cross-stay',
        },
      }),
    )
    await rejects('an ORIGINAL of zero minutes is refused — zero is only a void', () =>
      prisma.serviceEntry.create({
        data: {
          stayId: danny.stayId, minutes: 0,
          workedOn: new Date(`${today}T00:00:00.000Z`), location: 'x',
          recordedById: original.recordedById,
        },
      }),
    )
    await rejects('a blank location is refused', () =>
      prisma.serviceEntry.create({
        data: {
          stayId: danny.stayId, minutes: 60,
          workedOn: new Date(`${today}T00:00:00.000Z`), location: '   ',
          recordedById: original.recordedById,
        },
      }),
    )
  })

  const voided = await tech(`/service/${amended.body.id}/amend`, {
    method: 'POST',
    body: JSON.stringify({ hours: 0, amendmentReason: 'Logged against the wrong resident.' }),
  })
  voided.status === 201 && voided.body.minutes === 0
    ? ok('an entry is VOIDED by amending it to zero with a reason')
    : bad('void', `${voided.status} ${JSON.stringify(voided.body)}`)

  // ── The total is derived ────────────────────────────────────────────────
  console.log('\n\x1b[1mThe total is derived\x1b[0m')

  const cols = await runAsSystem(async () =>
    prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('stays','residents','programs')
         AND (column_name ILIKE '%hoursworked%' OR column_name ILIKE '%servicetotal%'
              OR column_name ILIKE '%hoursLogged%')`),
  )
  cols.length === 0
    ? ok('no stored hours total exists anywhere — the sum is the only source')
    : bad('stored total', JSON.stringify(cols))

  const joy = find('Nakamura')
  const joySummary = await summaryOf(joy.id)
  joySummary.verifiedMinutes === 0 && joySummary.pendingMinutes === 0
    ? ok('a resident with no entries reads 0, not null')
    : bad('zero not null', JSON.stringify(joySummary))

  // ── Targets ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mTargets\x1b[0m')

  const rubenSummary = await summaryOf(ruben.id)
  rubenSummary.targetSource === 'STAY' && rubenSummary.requiredMinutes === 120 * 60
    ? ok('a per-stay override wins over the phase default, and says so')
    : bad('stay override', JSON.stringify(rubenSummary))

  const andreSummary = await summaryOf(andre.id)
  andreSummary.targetSource === 'PROGRAM' && andreSummary.requiredMinutes === 40 * 60
    ? ok('without an override the phase default applies, and says so')
    : bad('program default', JSON.stringify(andreSummary))

  const techTarget = await tech(`/residents/${danny.id}/service-target`, {
    method: 'PATCH', body: JSON.stringify({ hours: 500 }),
  })
  techTarget.status === 403
    ? ok('a tech cannot set a target — the obligation is not a hallway act')
    : bad('tech target refused', techTarget.status)

  const setTarget = await manager(`/residents/${danny.id}/service-target`, {
    method: 'PATCH', body: JSON.stringify({ hours: 200 }),
  })
  const retargeted = await summaryOf(danny.id)
  setTarget.status === 204 && retargeted.requiredMinutes === 200 * 60 && retargeted.targetSource === 'STAY'
    ? ok('a manager can set one')
    : bad('manager sets target', `${setTarget.status} ${JSON.stringify(retargeted)}`)

  const cleared = await manager(`/residents/${danny.id}/service-target`, {
    method: 'PATCH', body: JSON.stringify({ hours: null }),
  })
  const afterClear = await summaryOf(danny.id)
  cleared.status === 204 && afterClear.targetSource === 'PROGRAM'
    ? ok('clearing the override falls back to the phase default')
    : bad('clear override', JSON.stringify(afterClear))

  // ── Audit ───────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mAudit\x1b[0m')

  const audited = await runAsSystem(async () =>
    prisma.auditLog.count({ where: { entity: 'ServiceEntry' } }),
  )
  audited > 0
    ? ok(`service reads and writes are audited (${audited} rows)`)
    : bad('audited', audited)

  const leak = await runAsSystem(async () =>
    prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "audit_log"
       WHERE "entity" = 'ServiceEntry'
         AND ("entityId" ILIKE '%Habitat%' OR "entityId" ILIKE '%Food%')`),
  )
  leak[0].n === 0
    ? ok('audit rows carry ids only — no locations, no supervisors')
    : bad('no detail in audit', leak[0].n)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => {
  console.error(e)
  process.exit(1)
})
