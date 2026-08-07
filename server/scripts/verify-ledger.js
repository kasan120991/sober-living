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
import { postEntry } from '../src/services/ledger.js'

/** Cents to a plain dollar string, for assertion labels only. */
const money = (c) => `$${(c / 100).toFixed(2)}`

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

  // The assertion above uses rejects(), which only proves SOMETHING threw —
  // and that is exactly why a real bug hid behind it. Prisma 7's driver
  // adapter stopped populating `meta.target`, so postEntry's duplicate
  // detection silently stopped matching and callers got a 500 where CLAUDE.md
  // promises "that payment has already been recorded". A webhook reading that
  // as a failure retries forever. So: assert the STATUS, not just the throw.
  try {
    await postEntry(
      {
        stayId: castillo.stayId,
        type: 'PAYMENT',
        amountCents: 5000,
        description: 'Card payment',
        occurredAt: new Date(),
        externalRef: ref,
      },
      anyEntry.recordedById,
    )
    bad('duplicate is a 409', 'the write was allowed')
  } catch (err) {
    err?.status === 409
      ? ok('and it is a 409 "already recorded", not a 500 — what a webhook must see')
      : bad('duplicate is a 409', `status ${err?.status}: ${err?.message}`)
  }

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

  // ── Invoicing ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mInvoicing: the sweep and the snapshot\x1b[0m')

  const sent = await manager(`/residents/${boone.id}/invoices`, {
    method: 'POST',
    body: {},
  })
  sent.status === 201
    ? ok(`a manager sweeps a stay's unbilled lines into one invoice (${money(sent.body.totalCents)})`)
    : bad('send invoice', `${sent.status} ${JSON.stringify(sent.body)}`)

  const invoiceId = sent.body.id
  const afterSend = (await manager(`/residents/${boone.id}/ledger`)).body
  afterSend.unbilledCents === 0
    ? ok('and nothing is left unbilled on that stay')
    : bad('all swept', afterSend.unbilledCents)
  afterSend.entries.some((e) => e.billed && e.invoice?.id === invoiceId)
    ? ok('the ledger marks those lines billed, and names the invoice')
    : bad('billed projection', 'no entry carries the invoice')

  const nothingLeft = await manager(`/residents/${boone.id}/invoices`, {
    method: 'POST',
    body: {},
  })
  nothingLeft.status === 409
    ? ok(`a second sweep with nothing unbilled is refused — "${nothingLeft.body?.error}"`)
    : bad('empty sweep', nothingLeft.status)

  // THE SNAPSHOT, proved three ways. CLAUDE.md warns the next reader will
  // otherwise delete the invoice total as a violation of "the balance is
  // derived" — it is a different fact, and these say so.
  const beforeTotal = sent.body.totalCents
  const beforeBalance = afterSend.balanceCents
  await manager(`/residents/${boone.id}/ledger`, {
    method: 'POST',
    body: {
      type: 'CREDIT',
      amount: '30.00',
      description: 'Adjustment after invoicing',
    },
  })
  const afterCorrection = (await manager(`/residents/${boone.id}/ledger`)).body
  const invAfter = await runAsSystem(async () =>
    prisma.invoice.findUnique({ where: { id: invoiceId } }),
  )
  invAfter.totalCents === beforeTotal && afterCorrection.balanceCents !== beforeBalance
    ? ok('a correction moves the BALANCE and leaves the invoice total untouched')
    : bad('snapshot holds', `${beforeTotal} → ${invAfter.totalCents}`)
  afterCorrection.unbilledCents === -3000
    ? ok('and it lands UNBILLED, to flow onto the next invoice')
    : bad('correction unbilled', afterCorrection.unbilledCents)

  await runAsSystem(async () => {
    await rejects('the invoice total cannot be updated — a snapshot, not a cache', () =>
      prisma.invoice.update({ where: { id: invoiceId }, data: { totalCents: 1 } }),
    )
    await rejects('an invoice cannot be deleted — it is voided, with a reason', () =>
      prisma.invoice.delete({ where: { id: invoiceId } }),
    )
    const line = await prisma.invoiceLine.findFirst({ where: { invoiceId } })
    await rejects('an invoice line cannot be deleted — billed once, forever', () =>
      prisma.invoiceLine.delete({ where: { id: line.id } }),
    )
    await rejects('the same ledger entry cannot be billed twice', () =>
      prisma.invoiceLine.create({
        data: { invoiceId, ledgerEntryId: line.ledgerEntryId },
      }),
    )
  })

  const owner2 = new (await import('pg')).default.Client({
    connectionString: process.env.DATABASE_URL,
  })
  await owner2.connect()
  await rejects('a SUPERUSER cannot move the total either — the trigger holds', () =>
    owner2.query(`UPDATE "invoices" SET "totalCents" = 1 WHERE id = $1`, [invoiceId]),
  )
  await rejects('a PAYMENT cannot be billed as a line (trigger)', () =>
    owner2.query(
      `INSERT INTO "invoice_lines" ("id","invoiceId","ledgerEntryId")
       SELECT 'verify-pay-line', $1, "id" FROM "ledger_entries"
        WHERE "stayId" = $2 AND "type" = 'PAYMENT' LIMIT 1`,
      [invoiceId, boone.stayId],
    ),
  )
  await owner2.end()

  const noBalanceCol = await runAsSystem(async () =>
    prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'invoices' AND column_name ILIKE '%balance%'`),
  )
  noBalanceCol.length === 0
    ? ok('and no balance column crept onto invoices — the total is a different fact')
    : bad('no balance column', JSON.stringify(noBalanceCol))

  // A resident with no email is ORDINARY — intake requires only a name — but
  // Stripe's hosted invoicing cannot proceed without one. The rule is pure so
  // it holds without a key, and so the dialog can refuse for the server's
  // reason rather than a copy of it.
  const { canHostInvoice } = await import('../src/services/invoices.js')
  canHostInvoice({ email: 'a@b.test' }) &&
  !canHostInvoice({ email: null }) &&
  !canHostInvoice({ email: '   ' }) &&
  !canHostInvoice(null)
    ? ok('a resident with no email cannot be invoiced through Stripe — refused before anything is billed')
    : bad('canHostInvoice', 'the email rule does not hold')

  // ── Overdue ──────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mOverdue is derived\x1b[0m')

  const castilloRecord = (await manager(`/residents/${castillo.residentId ?? castillo.id}`)).body
  castilloRecord.current?.invoices?.overdue === true &&
  castilloRecord.current?.invoices?.dotDue === true
    ? ok('the seeded three-week-old invoice reads overdue, and past the 7-day dot grace')
    : bad('overdue derived', JSON.stringify(castilloRecord.current?.invoices))

  // Squaring the balance settles it WITHOUT touching the invoice — the clause
  // that stops the dot burning forever on somebody who paid cash at the desk.
  const owedBefore = castilloRecord.current.balanceCents
  const invBeforePay = await runAsSystem(async () =>
    prisma.invoice.findFirst({ where: { stayId: castilloRecord.current.stayId } }),
  )
  await manager(`/residents/${castillo.id}/ledger`, {
    method: 'POST',
    body: {
      type: 'PAYMENT',
      amount: String(owedBefore / 100),
      description: 'Cash at the desk',
    },
  })
  const afterPay = (await manager(`/residents/${castillo.id}`)).body
  const invAfterPay = await runAsSystem(async () =>
    prisma.invoice.findUnique({ where: { id: invBeforePay.id } }),
  )
  afterPay.current.invoices.overdue === false
    ? ok('paying the balance clears overdue — cash at the desk counts, not only Stripe')
    : bad('cash clears overdue', JSON.stringify(afterPay.current.invoices))
  invAfterPay.status === invBeforePay.status && invAfterPay.paidAt === invBeforePay.paidAt
    ? ok('and NOTHING was written to the invoice to do it — that is what derived means')
    : bad('no invoice write', `${invBeforePay.status} → ${invAfterPay.status}`)

  // ── What may reach Stripe ────────────────────────────────────────────────
  console.log('\n\x1b[1mWhat may reach Stripe\x1b[0m')

  const { stripeLineLabel, invoiceMetadata } = await import('../src/services/invoices.js')
  const { LEDGER_CATEGORY, STRIPE_LINE_LABEL } = await import('../src/domain/constants.js')
  const allowed = new Set(Object.values(STRIPE_LINE_LABEL))
  const labels = Object.values(LEDGER_CATEGORY).map((c) =>
    stripeLineLabel({ type: 'CHARGE', category: c, description: 'Rent, after the relapse' }),
  )
  labels.every((l) => allowed.has(l))
    ? ok('every category maps to a fixed label — never the description a human typed')
    : bad('labels fixed', JSON.stringify(labels))
  !labels.some((l) => /relapse|lab|screen|test result|positive/i.test(l))
    ? ok('and no label leaks a clinical inference — LAB_FEE reads "Testing fee"')
    : bad('label leaks', JSON.stringify(labels))
  const meta = invoiceMetadata({ invoiceId: 'a', stayId: 'b', residentId: 'c' })
  Object.keys(meta).length === 3 && !JSON.stringify(meta).includes('@')
    ? ok('metadata is opaque ids only')
    : bad('metadata opaque', JSON.stringify(meta))

  const sysLogin = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'stripe@system.soberlife', password: PW }),
  })
  sysLogin.status >= 400
    ? ok('the Stripe system account cannot log in')
    : bad('system user login', sysLogin.status)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => { console.error(e); process.exit(1) })
