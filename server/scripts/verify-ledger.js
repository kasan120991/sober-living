/**
 * The fee ledger — balances, append-only history, and the guards that make a
 * money record defensible.
 *
 * Run after `node scripts/seed.js`. Posts entries and does not clean up, so
 * reseed afterwards.
 */
import { createApp } from '../src/app.js'
import { prisma } from '../src/db/client.js'
import { runAsSystem } from '../src/lib/dbContext.js'

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
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
  }

  const manager = as(await login('manager@facility.test'))
  const tech = as(await login('tech@facility.test'))

  const roster = await manager('/residents')
  const rows = roster.body?.residents ?? []
  const find = (last) => rows.find((r) => r.lastName === last)

  // ── Derivation ───────────────────────────────────────────────────────────
  console.log('\n\x1b[1mBalances are derived, not stored\x1b[0m')

  const castillo = find('Castillo')
  castillo?.balanceCents === 108000
    ? ok('roster carries a balance per resident (Castillo $1080.00)')
    : bad('roster balance', `got ${castillo?.balanceCents}`)

  const ferrer = find('Ferrer')
  ferrer?.balanceCents === -10000
    ? ok('a credit reads as a negative balance (Ferrer −$100.00)')
    : bad('credit balance', `got ${ferrer?.balanceCents}`)

  const nakamura = find('Nakamura')
  nakamura?.balanceCents === 0
    ? ok('a resident with no entries is $0.00, not null')
    : bad('zero balance', `got ${nakamura?.balanceCents}`)

  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name IN ('stays','residents') AND column_name ILIKE '%balance%'`)
  cols.length === 0
    ? ok('no balance column exists anywhere — the sum is the only source')
    : bad('stored balance', JSON.stringify(cols))

  const ledger = await manager(`/residents/${castillo.id}/ledger`)
  const running = ledger.body.entries.at(-1)?.runningCents
  ledger.body.balanceCents === castillo.balanceCents
    ? ok('the record and the roster agree on the balance')
    : bad('agreement', `${ledger.body.balanceCents} vs ${castillo.balanceCents}`)
  running === 65000
    ? ok('a running balance is attached to each line')
    : bad('running balance', `oldest line ran to ${running}`)

  // ── Append-only ──────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe ledger cannot be rewritten\x1b[0m')

  const anyEntry = await prisma.ledgerEntry.findFirst({ where: { stayId: castillo.stayId } })

  await rejects('UPDATE on an entry is refused', () =>
    prisma.ledgerEntry.update({ where: { id: anyEntry.id }, data: { amountCents: 1 } }),
  )
  await rejects('DELETE on an entry is refused', () =>
    prisma.ledgerEntry.delete({ where: { id: anyEntry.id } }),
  )
  await rejects('raw SQL UPDATE is refused too', () =>
    prisma.$executeRawUnsafe(`UPDATE "ledger_entries" SET "amountCents" = 1 WHERE id = $1`, anyEntry.id),
  )

  // ── Shape of a line ──────────────────────────────────────────────────────
  console.log('\n\x1b[1mWhat a line must say\x1b[0m')

  const post = (body) => manager(`/residents/${castillo.id}/ledger`, { method: 'POST', body })

  const good = await post({ type: 'CHARGE', category: 'TRIP', amount: '42.50', description: 'Trip fee' })
  good.status === 201 && good.body.amountCents === 4250
    ? ok('a charge posts, and dollars parse to cents (42.50 → 4250)')
    : bad('post a charge', `${good.status} ${JSON.stringify(good.body)}`)

  const cents = await post({ type: 'CHARGE', category: 'OTHER', amount: '12.10', description: 'Rounding check' })
  cents.body?.amountCents === 1210
    ? ok('12.10 parses to exactly 1210 cents, not 1209')
    : bad('float rounding', `got ${cents.body?.amountCents}`)

  const noCat = await post({ type: 'CHARGE', amount: '10', description: 'Uncategorised' })
  noCat.status === 400 ? ok('a charge without a category is refused') : bad('charge needs category', noCat.status)

  const payCat = await post({ type: 'PAYMENT', category: 'RENT', amount: '10', description: 'Payment' })
  payCat.status === 400 ? ok('a payment carrying a category is refused') : bad('payment has no category', payCat.status)

  const neg = await post({ type: 'CHARGE', category: 'RENT', amount: '-50', description: 'Negative' })
  neg.status === 400 ? ok('a negative amount is refused — the sign lives in the type') : bad('negative', neg.status)

  const zero = await post({ type: 'PAYMENT', amount: '0', description: 'Zero' })
  zero.status === 400 ? ok('a zero amount is refused') : bad('zero', zero.status)

  const blank = await post({ type: 'PAYMENT', amount: '10', description: '   ' })
  blank.status === 400 ? ok('a blank description is refused') : bad('blank description', blank.status)

  await rejects('the database refuses a negative amount even directly', () =>
    prisma.ledgerEntry.create({
      data: {
        stayId: castillo.stayId, type: 'PAYMENT', amountCents: -1,
        description: 'direct', occurredAt: new Date(), recordedById: anyEntry.recordedById,
      },
    }),
  )

  // ── Processor idempotency ────────────────────────────────────────────────
  console.log('\n\x1b[1mA webhook delivered twice\x1b[0m')

  const ref = `pi_verify_${Date.now()}`
  const first = await runAsSystem(async () =>
    prisma.ledgerEntry.create({
      data: {
        stayId: castillo.stayId, type: 'PAYMENT', amountCents: 5000,
        description: 'Card payment', occurredAt: new Date(),
        recordedById: anyEntry.recordedById, externalRef: ref,
      },
    }),
  )
  first?.id ? ok('a payment with a processor reference posts once') : bad('first webhook', 'no row')

  await rejects('the same reference a second time is refused', () =>
    prisma.ledgerEntry.create({
      data: {
        stayId: castillo.stayId, type: 'PAYMENT', amountCents: 5000,
        description: 'Card payment', occurredAt: new Date(),
        recordedById: anyEntry.recordedById, externalRef: ref,
      },
    }),
  )

  await rejects('a processor reference on a CHARGE is refused', () =>
    prisma.ledgerEntry.create({
      data: {
        stayId: castillo.stayId, type: 'CHARGE', category: 'RENT', amountCents: 100,
        description: 'not a payment', occurredAt: new Date(),
        recordedById: anyEntry.recordedById, externalRef: `${ref}_x`,
      },
    }),
  )

  // ── Corrections ──────────────────────────────────────────────────────────
  console.log('\n\x1b[1mCorrections stay in their own stay\x1b[0m')

  const boone = find('Boone')
  const otherEntry = await prisma.ledgerEntry.findFirst({ where: { stayId: boone.stayId } })
  await rejects("a correction cannot point at another resident's line", () =>
    prisma.ledgerEntry.create({
      data: {
        stayId: castillo.stayId, type: 'CREDIT', amountCents: 100,
        description: 'cross-stay', occurredAt: new Date(),
        recordedById: anyEntry.recordedById, correctsId: otherEntry.id,
      },
    }),
  )

  // ── Authorization ────────────────────────────────────────────────────────
  console.log('\n\x1b[1mWho may read and who may post\x1b[0m')

  const techRead = await tech(`/residents/${castillo.id}/ledger`)
  techRead.status === 200
    ? ok('a tech can read a balance — answering "what do I owe" needs no manager')
    : bad('tech read', techRead.status)

  const techPost = await tech(`/residents/${castillo.id}/ledger`, {
    method: 'POST',
    body: { type: 'PAYMENT', amount: '10', description: 'tech attempt' },
  })
  techPost.status === 403 ? ok('a tech cannot post to it') : bad('tech post', techPost.status)

  // ── Audit ────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe paper trail\x1b[0m')

  const audited = await prisma.auditLog.count({ where: { entity: 'LedgerEntry' } })
  audited > 0 ? ok(`ledger access is audited (${audited} rows)`) : bad('audited', audited)

  const leak = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM "audit_log"
     WHERE "entity" = 'LedgerEntry' AND ("entityId" ILIKE '%Rent%' OR "entityId" ILIKE '%$%')`)
  leak[0].n === 0
    ? ok('audit rows carry ids only — no amounts, no descriptions')
    : bad('no detail in audit', leak[0].n)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => { console.error(e); process.exit(1) })
