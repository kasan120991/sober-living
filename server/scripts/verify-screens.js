/**
 * Drug screens — the arc, the money, and what must never leak.
 *
 * What this proves: a screen's collection half is immutable and its
 * confirmation arc runs one way, once, enforced against the app role by
 * PRIVILEGE and against a superuser by TRIGGER — asserted separately; the
 * resident's decision is a record either way; the $50 lands exactly once and
 * a lab result NEVER moves money; the cup survives a contradicting lab; a
 * correction is an amendment that carries the arc forward; a resident can read
 * their own screens and no one else's; and NOTHING from this module reaches
 * the bell or the dashboard.
 *
 * Run after `node scripts/seed.js`. Posts screens AND a ledger charge, so
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

  const tech = as(await login('tech@facility.test'))
  const manager = as(await login('manager@facility.test'))

  const pg = (await import('pg')).default
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await owner.connect()

  const rows = (await manager('/residents?includeDischarged=true')).body.residents
  const find = (last) => rows.find((r) => r.lastName === last)
  const whitfield = find('Whitfield')
  const castillo = find('Castillo')
  const ramsey = find('Ramsey')
  const techUser = await runAsSystem(async () =>
    prisma.user.findFirst({ where: { email: 'tech@facility.test' } }),
  )

  // ── The gate ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe gate\x1b[0m')

  ;(await fetch(`${base}/screens`)).status === 401
    ? ok('anonymous is refused')
    : bad('anon 401', 'not 401')

  const board = await tech('/screens')
  board.status === 200
    ? ok('a tech reads the work queue — collecting is a hallway job')
    : bad('tech reads queue', board.status)
  board.body.feeCents === 5000
    ? ok('the queue echoes the fee, so a dialog cannot quote a figure the ledger disagrees with')
    : bad('feeCents echoed', board.body.feeCents)

  // ── The queue carries no outcomes ────────────────────────────────────────
  console.log('\n\x1b[1mThe queue carries no outcomes\x1b[0m')

  const queueJson = JSON.stringify(board.body.bands)
  !/"result"|"labResult"|"substances"/.test(queueJson)
    ? ok('no result, no substances, no lab result anywhere in the queue payload')
    : bad('queue leaks outcomes', 'found a result field')
  !/POSITIVE|NEGATIVE|DILUTE|REFUSAL|THC|OPIATES/.test(queueJson)
    ? ok('and no outcome VALUE leaks either — the reveal is a real boundary, not a curtain')
    : bad('queue leaks values', 'found an outcome value')

  // ── Recording, and the shape it must have ────────────────────────────────
  console.log('\n\x1b[1mRecording\x1b[0m')

  const post = (body) => tech('/screens', { method: 'POST', body: JSON.stringify(body) })
  const baseScreen = {
    residentId: whitfield.id,
    reason: 'RANDOM',
    method: 'URINE',
    witnessedById: techUser.id,
  }

  const negative = await post({ ...baseScreen, result: 'NEGATIVE' })
  negative.status === 201
    ? ok('a tech records a negative')
    : bad('record negative', `${negative.status} ${JSON.stringify(negative.body)}`)
  negative.body.confirmation === 'NOT_OFFERED'
    ? ok('a negative is NOT_OFFERED — there is nothing to confirm')
    : bad('negative not offered', negative.body.confirmation)

  const noSubs = await post({ ...baseScreen, result: 'POSITIVE', specimenId: 'X-1' })
  noSubs.status === 400
    ? ok('a positive with no substances is refused — "positive for something" is not a record')
    : bad('positive needs substances', noSubs.status)
  const straySubs = await post({ ...baseScreen, result: 'NEGATIVE', substances: ['THC'] })
  straySubs.status === 400
    ? ok('only a positive carries substances')
    : bad('stray substances', straySubs.status)
  const noSpecimen = await post({ ...baseScreen, result: 'POSITIVE', substances: ['THC'] })
  noSpecimen.status === 400
    ? ok('a specimen with no seal number is refused — it could not be tied to a lab report')
    : bad('specimen id required', noSpecimen.status)

  const refusal = await post({ ...baseScreen, result: 'REFUSAL' })
  refusal.body?.confirmation === 'NOT_OFFERED'
    ? ok('a REFUSAL is NOT_OFFERED — there is no specimen to send')
    : bad('refusal not offered', refusal.body?.confirmation)

  const positive = await post({
    ...baseScreen,
    reason: 'FOR_CAUSE',
    result: 'POSITIVE',
    substances: ['THC', 'THC', 'COCAINE'],
    specimenId: 'SL-99001',
  })
  positive.status === 201 && positive.body.confirmation === 'PENDING_DECISION'
    ? ok('a positive lands awaiting the resident’s decision')
    : bad('positive pending decision', JSON.stringify(positive.body))
  positive.body.outcome.substances.length === 2
    ? ok('duplicate substances are deduped')
    : bad('dedupe', JSON.stringify(positive.body.outcome.substances))

  const discharged = await post({ ...baseScreen, residentId: ramsey.id, result: 'NEGATIVE' })
  discharged.status === 409
    ? ok('you cannot collect from somebody who has left the program')
    : bad('discharged refused', discharged.status)

  const future = await post({
    ...baseScreen,
    result: 'NEGATIVE',
    collectedAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  })
  future.status >= 400
    ? ok('a collection in the future is refused')
    : bad('future refused', future.status)
  const ancient = await post({
    ...baseScreen,
    result: 'NEGATIVE',
    collectedAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
  })
  ancient.status >= 400
    ? ok('back-filling three days is refused — the window is a shift, not a week')
    : bad('ancient refused', ancient.status)

  // ── The reveal ───────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe reveal\x1b[0m')

  const revealed = await tech(`/screens/${positive.body.id}`)
  revealed.body.outcome.result === 'POSITIVE' && revealed.body.outcome.substances.includes('THC')
    ? ok('one screen fetched by id carries its outcome — this is the reveal')
    : bad('reveal', JSON.stringify(revealed.body?.outcome))

  const audited = await runAsSystem(async () =>
    prisma.auditLog.count({ where: { entity: 'DrugScreen' } }),
  )
  audited > 0
    ? ok(`the reveal is audited (${audited} DrugScreen rows) — it can answer who looked at whose result`)
    : bad('audited', audited)

  // ── The resident's decision ──────────────────────────────────────────────
  console.log('\n\x1b[1mThe resident’s decision\x1b[0m')

  const decide = (id, body) =>
    tech(`/screens/${id}/decision`, { method: 'POST', body: JSON.stringify(body) })

  const onNegative = await decide(negative.body.id, { decision: 'DECLINED' })
  onNegative.status === 409
    ? ok('there is nothing to decide on a negative')
    : bad('decision on negative', onNegative.status)

  const noLab = await decide(positive.body.id, { decision: 'REQUESTED' })
  noLab.status === 400
    ? ok('electing confirmation without naming the lab is refused')
    : bad('lab name required', noLab.status)

  const beforeLedger = (await manager(`/residents/${whitfield.id}/ledger`)).body
  const requested = await decide(positive.body.id, {
    decision: 'REQUESTED',
    labName: 'Quest Diagnostics',
    labReference: 'Q-1234',
  })
  requested.status === 200 && requested.body.confirmation === 'REQUESTED'
    ? ok('a TECH records the election — the resident answers in front of whoever holds the cup')
    : bad('decision recorded', `${requested.status} ${JSON.stringify(requested.body)}`)
  requested.body.residentDecisionAt && requested.body.decisionRecordedBy
    ? ok('the decision carries its instant and its author')
    : bad('decision pair', JSON.stringify(requested.body))

  const afterLedger = (await manager(`/residents/${whitfield.id}/ledger`)).body
  const labFees = afterLedger.entries.filter((e) => e.category === 'LAB_FEE')
  labFees.length === 1 && labFees[0].amountCents === 5000
    ? ok('exactly one $50 LAB_FEE charge is posted')
    : bad('one fee', JSON.stringify(labFees))
  afterLedger.balanceCents - beforeLedger.balanceCents === 5000
    ? ok('and the balance moved by exactly the fee')
    : bad('balance moved', afterLedger.balanceCents - beforeLedger.balanceCents)
  !/POSITIVE|THC|positive/.test(labFees[0]?.description ?? '')
    ? ok('the ledger description names no result and no substance')
    : bad('ledger description leaks', labFees[0]?.description)

  const twice = await decide(positive.body.id, { decision: 'DECLINED' })
  twice.status === 409
    ? ok('a second decision on the same screen is refused')
    : bad('one decision', twice.status)

  // ── The lab ──────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe lab\x1b[0m')

  const lab = (id, body) => tech(`/screens/${id}/lab`, { method: 'POST', body: JSON.stringify(body) })

  const early = await lab(negative.body.id, { labResult: 'NEGATIVE' })
  early.status === 409
    ? ok('a lab result with no confirmation outstanding is refused')
    : bad('lab needs requested', early.status)
  const vocab = await lab(positive.body.id, { labResult: 'REFUSAL' })
  vocab.status >= 400
    ? ok('a lab cannot report a REFUSAL — that is a fact about the person, recorded at collection')
    : bad('lab vocabulary', vocab.status)

  const returned = await lab(positive.body.id, { labResult: 'NEGATIVE' })
  returned.status === 200 && returned.body.confirmation === 'RETURNED'
    ? ok('the lab result is recorded')
    : bad('lab recorded', `${returned.status} ${JSON.stringify(returned.body)}`)

  const o = returned.body.outcome
  o.result === 'POSITIVE' && o.labResult === 'NEGATIVE'
    ? ok('THE CUP SURVIVES: the screen still says the cup read positive')
    : bad('cup survives', JSON.stringify(o))
  o.contradicted === true && o.effectiveResult === 'NEGATIVE'
    ? ok('the contradiction is derived, and the lab is authoritative')
    : bad('contradiction', JSON.stringify(o))
  o.refundDue === true
    ? ok('a paid confirmation the lab cleared is flagged for review')
    : bad('refundDue', JSON.stringify(o))

  const afterLab = (await manager(`/residents/${whitfield.id}/ledger`)).body
  afterLab.balanceCents === afterLedger.balanceCents
    ? ok('AND NO MONEY MOVED — the refund is case-by-case, decided by a manager')
    : bad('no auto refund', `${afterLedger.balanceCents} → ${afterLab.balanceCents}`)

  const twiceLab = await lab(positive.body.id, { labResult: 'POSITIVE', labSubstances: ['THC'] })
  twiceLab.status === 409
    ? ok('a second lab result is refused')
    : bad('one lab result', twiceLab.status)

  // The manager settles it by hand, through the route that already gates money.
  const credit = await manager(`/residents/${whitfield.id}/ledger`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CREDIT',
      amount: '50.00',
      description: 'Lab confirmation refunded — lab cleared the cup',
      correctsId: labFees[0].id,
    }),
  })
  credit.status === 201
    ? ok('a manager posts the credit by hand, through the manager-gated ledger route')
    : bad('manual credit', `${credit.status} ${JSON.stringify(credit.body)}`)
  const settled = (await tech('/screens')).body.bands.returned.find(
    (r) => r.id === positive.body.id,
  )
  settled && settled.refundDue === false
    ? ok('and the review clears itself — a settled refund is derived from the credit, never flagged')
    : bad('refund settles', JSON.stringify(settled))

  // ── Amendment ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mAmendment\x1b[0m')

  const amend = (id, body) =>
    tech(`/screens/${id}/amend`, { method: 'POST', body: JSON.stringify(body) })

  const noReason = await amend(positive.body.id, { note: 'fixed' })
  noReason.status === 400
    ? ok('an amendment with no reason is refused — the reason IS the record')
    : bad('reason required', noReason.status)

  const toNegative = await amend(positive.body.id, {
    amendmentReason: 'misread',
    result: 'NEGATIVE',
  })
  toNegative.status === 409
    ? ok('a decided screen cannot be amended to an unconfirmable result — that would erase a real decision')
    : bad('result class change', toNegative.status)

  const amended = await amend(positive.body.id, {
    amendmentReason: 'Witness was Priya, not me.',
    note: 'Corrected the witness.',
  })
  amended.status === 201 && amended.body.amended
    ? ok('a tech amends a screen')
    : bad('amend', `${amended.status} ${JSON.stringify(amended.body)}`)
  amended.body.collectedAt === positive.body.collectedAt
    ? ok('collectedAt is carried verbatim — an amendment corrects what was observed, never when')
    : bad('collectedAt carried', amended.body.collectedAt)
  amended.body.confirmation === 'RETURNED' && amended.body.outcome.labResult === 'NEGATIVE'
    ? ok('THE ARC CARRIES FORWARD: a typo fix does not un-elect a confirmation or un-report a lab')
    : bad('arc carried', JSON.stringify(amended.body.confirmation))

  const feesAfterAmend = (await manager(`/residents/${whitfield.id}/ledger`)).body.entries.filter(
    (e) => e.category === 'LAB_FEE',
  )
  feesAfterAmend.length === 1
    ? ok('and the amended screen still has exactly ONE charge — the fee did not post twice')
    : bad('one fee after amend', feesAfterAmend.length)

  const again = await amend(positive.body.id, { amendmentReason: 'again' })
  again.status === 409
    ? ok('a second amendment of the original is refused — no forked chain')
    : bad('no fork', again.status)

  await rejects('the database refuses an amendment with a NULL reason (CHECK)', () =>
    owner.query(
      `INSERT INTO "drug_screens" ("id","stayId","reason","method","collectedAt","witnessedById","result","recordedById","confirmation","supersedesId")
       SELECT 'verify-null-reason', "stayId", 'RANDOM', 'URINE', now(), "witnessedById", 'NEGATIVE', "recordedById", 'NOT_OFFERED', "id"
         FROM "drug_screens" WHERE "id" = $1`,
      [negative.body.id],
    ),
  )
  await rejects('a screen amendment cannot cross to another stay (trigger)', () =>
    owner.query(
      `INSERT INTO "drug_screens" ("id","stayId","reason","method","collectedAt","witnessedById","result","recordedById","confirmation","supersedesId","amendmentReason")
       VALUES ('verify-cross-stay', (SELECT "id" FROM "stays" WHERE "residentId" = $1 LIMIT 1),
               'RANDOM','URINE',now(),$2,'NEGATIVE',$2,'NOT_OFFERED',$3,'cross-stay test')`,
      [castillo.id, techUser.id, negative.body.id],
    ),
  )

  // ── Append-only, two layers asserted separately ──────────────────────────
  console.log('\n\x1b[1mAppend-only, two layers asserted separately\x1b[0m')

  await runAsSystem(async () => {
    await rejects('the app role cannot UPDATE the result (privilege)', () =>
      prisma.drugScreen.update({ where: { id: negative.body.id }, data: { result: 'POSITIVE' } }),
    )
    await rejects('the app role cannot UPDATE the note (privilege)', () =>
      prisma.drugScreen.update({ where: { id: negative.body.id }, data: { note: 'edited' } }),
    )
    await rejects('the app role cannot DELETE (privilege)', () =>
      prisma.drugScreen.delete({ where: { id: negative.body.id } }),
    )
  })

  await rejects('a SUPERUSER cannot UPDATE the result — the trigger holds', () =>
    owner.query(`UPDATE "drug_screens" SET "result" = 'POSITIVE' WHERE id = $1`, [negative.body.id]),
  )
  await rejects('a column in no whitelist (note) is immutable by default, even to a superuser', () =>
    owner.query(`UPDATE "drug_screens" SET "note" = 'edited' WHERE id = $1`, [negative.body.id]),
  )
  await rejects('a SUPERUSER cannot DELETE — the trigger holds', () =>
    owner.query(`DELETE FROM "drug_screens" WHERE id = $1`, [negative.body.id]),
  )
  await rejects('the arc cannot run backwards (trigger)', () =>
    owner.query(
      `UPDATE "drug_screens" SET "confirmation" = 'PENDING_DECISION' WHERE id = $1`,
      [positive.body.id],
    ),
  )
  await rejects('a superseded screen cannot transition (trigger)', () =>
    owner.query(
      `UPDATE "drug_screens" SET "confirmation" = 'RETURNED', "labResult" = 'POSITIVE',
              "labSubstances" = ARRAY['THC']::"Substance"[], "labReturnedAt" = now(), "labRecordedById" = $2
         WHERE id = $1`,
      [positive.body.id, techUser.id],
    ),
  )
  await owner.end()

  // ── Row-level security ───────────────────────────────────────────────────
  console.log('\n\x1b[1mRow-level security\x1b[0m')

  const asWhitfield = (fn) =>
    runWithDbActor({ kind: ACTOR.RESIDENT, residentId: whitfield.id }, async () => await fn())
  const mine = await asWhitfield(() => prisma.drugScreen.findMany())
  const myStays = await asWhitfield(() => prisma.stay.findMany({ select: { id: true } }))
  const myStayIds = new Set(myStays.map((s) => s.id))
  mine.length > 0 && mine.every((s) => myStayIds.has(s.stayId))
    ? ok(`a resident reads their OWN screens (${mine.length}) and only those`)
    : bad('own screens', `${mine.length} rows`)

  const asCastillo = (fn) =>
    runWithDbActor({ kind: ACTOR.RESIDENT, residentId: castillo.id }, async () => await fn())
  const theirs = await asCastillo(() =>
    prisma.drugScreen.findMany({ where: { stayId: { in: [...myStayIds] } } }),
  )
  theirs.length === 0
    ? ok("and none of another resident's, even asking for them by stay id")
    : bad('other screens hidden', theirs.length)

  // ── The record section ───────────────────────────────────────────────────
  console.log('\n\x1b[1mThe resident record\x1b[0m')

  const section = await tech(`/residents/${whitfield.id}/screens`)
  section.body.hasActiveStay === true && section.body.screens.length > 0
    ? ok(`an active resident's section lists their screens (${section.body.screens.length})`)
    : bad('record section', JSON.stringify(section.body).slice(0, 120))

  // The record section DOES carry outcomes, deliberately unlike the queue
  // (2026-08-06): it is one named person somebody navigated to on purpose,
  // which is module 1's own argument for techs seeing Clinical at all.
  section.body.screens.every((s) => s.outcome && 'contradicted' in s.outcome)
    ? ok('and every row carries its outcome — a record page is one person, chosen on purpose')
    : bad('section outcomes', JSON.stringify(section.body.screens[0]).slice(0, 160))

  const sum = section.body.summary
  sum && sum.total === section.body.screens.length
    ? ok(`the summary counts every screen on the stay (${sum.total})`)
    : bad('summary total', JSON.stringify(sum))
  sum.negative + sum.positive + sum.dilute + sum.refusal + sum.notRead + sum.overturned === sum.total
    ? ok('and its buckets add up to that total — no screen counted twice or dropped')
    : bad('buckets add up', JSON.stringify(sum))
  // The screen whose cup read positive and whose lab cleared it is its OWN
  // bucket: counting it positive would contradict the lab being
  // authoritative, and counting it negative would hide that a cup read
  // positive at all.
  sum.overturned === 1 && sum.positive === 0
    ? ok('an overturned screen is its own bucket — neither positive nor silently negative')
    : bad('overturned bucket', JSON.stringify(sum))
  const goneSection = await tech(`/residents/${ramsey.id}/screens`)
  goneSection.body.hasActiveStay === false && goneSection.body.screens.length === 0
    ? ok('a discharged resident gets the no-active-stay payload, not an error')
    : bad('discharged section', JSON.stringify(goneSection.body))
  const record = (await tech(`/residents/${whitfield.id}`)).body
  record.current?.screens === undefined
    ? ok('GET /residents/:id carries NO screens block — no dot can be hung on the rail')
    : bad('no screens on record', JSON.stringify(record.current?.screens))

  // ── Decision 7, asserted as a negative ───────────────────────────────────
  console.log('\n\x1b[1mNothing reaches the bell or the dashboard\x1b[0m')

  // Asserted against the SERIALISED payload, not a list of known keys: a
  // key-list assertion passes the day somebody adds attention.screensPending.
  const bell = JSON.stringify((await tech('/notifications')).body)
  const dash = JSON.stringify((await tech('/dashboard')).body)
  const clinical = /screen|Screen|SCREEN|POSITIVE|DILUTE|REFUSAL|THC|OPIATES|specimen/
  !clinical.test(bell)
    ? ok('the bell payload contains nothing from module 5')
    : bad('bell leaks', bell.slice(0, 200))
  !clinical.test(dash)
    ? ok('the dashboard payload contains nothing from module 5')
    : bad('dashboard leaks', dash.slice(0, 200))
  !/"to":"\/screens"/.test(bell)
    ? ok('and no bell item links to /screens')
    : bad('bell links to screens', 'found a /screens link')

  // ── Audit ────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mAudit\x1b[0m')

  const leak = await runAsSystem(async () =>
    prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "audit_log"
       WHERE "entity" = 'DrugScreen'
         AND ("entityId" ILIKE '%POSITIVE%' OR "entityId" ILIKE '%THC%'
              OR "entityId" ILIKE '%SL-%' OR "entityId" ILIKE '%Quest%')`),
  )
  leak[0].n === 0
    ? ok('audit rows carry ids only — no results, no substances, no specimen numbers')
    : bad('audit leaks detail', leak[0].n)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => {
  console.error(e)
  process.exit(1)
})
