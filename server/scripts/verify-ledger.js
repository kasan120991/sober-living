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
import { draftInvoice } from '../src/services/invoices.js'

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
  // Voiding is admins only — the narrowest gate in the app.
  const admin = as(await login('admin@facility.test'))

  const managerUser = await runAsSystem(async () =>
    prisma.user.findUnique({ where: { email: 'manager@facility.test' }, select: { id: true } }),
  )

  /**
   * Bill a stay's pending lines LOCALLY, then promote the draft the way
   * Stripe's finalize would have.
   *
   * This suite runs with no Stripe key, and `sendInvoice` now refuses on a
   * keyless server rather than quietly producing a local-only invoice — so the
   * arc below is driven through the same two doors the seed uses. The route's
   * refusal is asserted separately; what these exercise is the arithmetic.
   */
  const billLocally = async (stayId, { dueAt = new Date() } = {}) =>
    runAsSystem(async () => {
      const { invoice } = await draftInvoice(stayId, { dueAt }, managerUser.id)
      return prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'OPEN',
          number: `T-${invoice.id.slice(-8)}`,
          // All four together, or `invoice_stripe_ids_paired` refuses the row:
          // an OPEN invoice must carry the full set a finalize would have set.
          stripeInvoiceId: `in_test_${invoice.id.slice(-8)}`,
          hostedUrl: `https://invoice.stripe.com/i/test_${invoice.id.slice(-8)}`,
          issuedAt: new Date(),
          finalizedAt: new Date(),
        },
      })
    })

  const roster = await manager('/residents')
  const rows = roster.body?.residents ?? []
  const find = (last) => rows.find((r) => r.lastName === last)

  // ── Derivation ───────────────────────────────────────────────────────────
  console.log('\n\x1b[1mBalances are derived, not stored\x1b[0m')

  const castillo = find('Castillo')
  castillo?.balanceCents === 97500
    ? ok('roster carries a balance per resident (Castillo $975.00 invoiced and unpaid)')
    : bad('roster balance', `got ${castillo?.balanceCents}`)

  const nakamura = find('Nakamura')
  nakamura?.balanceCents === 0
    ? ok('a resident with no entries is $0.00, not null')
    : bad('zero balance', `got ${nakamura?.balanceCents}`)

  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name IN ('stays','residents') AND column_name ILIKE '%balance%'`)
  cols.length === 0
    ? ok('no balance column exists anywhere — the derivation is the only source')
    : bad('stored balance', JSON.stringify(cols))

  const ledger = await manager(`/residents/${castillo.id}/ledger`)
  ledger.body.balanceCents === castillo.balanceCents
    ? ok('the record and the roster agree on the balance')
    : bad('agreement', `${ledger.body.balanceCents} vs ${castillo.balanceCents}`)
  ledger.body.entries.every((e) => e.runningCents === undefined)
    ? ok('no running-balance column — it could only ever agree with the header by luck')
    : bad('running gone', 'runningCents is still on the wire')

  // ── The rule itself ──────────────────────────────────────────────────────
  // A resident owes what has been INVOICED and not yet paid. These four pin
  // the rule in both directions, because the cheap version of each — checking
  // only that a charge does nothing, or only that an invoice does something —
  // passes just as well under the old arithmetic.
  console.log('\n\x1b[1mA balance is what has been invoiced and not paid\x1b[0m')

  const boone = find('Boone')
  const beforePost = await manager(`/residents/${boone.id}/ledger`)
  const posted = await manager(`/residents/${boone.id}/ledger`, {
    method: 'POST',
    body: {
      type: 'CHARGE',
      category: 'LAUNDRY',
      amount: '30.00',
      description: 'Laundry — probe',
    },
  })
  const afterPost = await manager(`/residents/${boone.id}/ledger`)
  posted.status === 201 &&
  afterPost.body.balanceCents === beforePost.body.balanceCents &&
  afterPost.body.pendingCents === beforePost.body.pendingCents + 3000
    ? ok('posting a charge moves PENDING only — it is not owed until it is billed')
    : bad(
        'charge is pending',
        `balance ${beforePost.body.balanceCents}→${afterPost.body.balanceCents}, pending ${beforePost.body.pendingCents}→${afterPost.body.pendingCents}`,
      )

  // A keyless server REFUSES the send, and bills nothing doing it. This is the
  // guard that replaced returning 201 with a local-only DRAFT — which looked
  // identical to a real send at the UI while the invoice would never exist.
  const keyless = await manager(`/residents/${boone.id}/invoices`, { method: 'POST', body: {} })
  const afterRefusal = await manager(`/residents/${boone.id}/ledger`)
  keyless.status === 503 && afterRefusal.body.pendingCents === afterPost.body.pendingCents
    ? ok('a server with no Stripe key refuses to send, and bills nothing doing it')
    : bad('keyless refusal', `${keyless.status}, pending now ${afterRefusal.body.pendingCents}`)

  const pendingNow = afterPost.body.pendingCents
  await billLocally(boone.stayId)
  const afterBill = await manager(`/residents/${boone.id}/ledger`)
  afterBill.body.pendingCents === 0 &&
  afterBill.body.balanceCents === beforePost.body.balanceCents + pendingNow
    ? ok('invoicing moves it from pending into the balance, to the cent')
    : bad(
        'invoice moves it',
        `pending ${afterBill.body.pendingCents}, balance ${afterBill.body.balanceCents}`,
      )

  // Nakamura has no entries at all: nothing invoiced, so nothing owed.
  const joyLedger = await manager(`/residents/${nakamura.id}/ledger`)
  joyLedger.body.balanceCents === 0 && joyLedger.body.pendingCents === 0
    ? ok('a stay nobody has invoiced owes nothing — zero, not a hidden pile')
    : bad('never invoiced', JSON.stringify(joyLedger.body).slice(0, 120))

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

  // Ocampo still has pending fees; Boone's were swept by the rule section.
  const ocampo = find('Ocampo')
  const sent = await billLocally(ocampo.stayId)
  sent.totalCents > 0
    ? ok(`a sweep collects a stay's pending lines into one invoice (${money(sent.totalCents)})`)
    : bad('send invoice', JSON.stringify(sent))

  const invoiceId = sent.id
  const afterSend = (await manager(`/residents/${ocampo.id}/ledger`)).body
  afterSend.pendingCents === 0
    ? ok('and nothing is left pending on that stay')
    : bad('all swept', afterSend.pendingCents)
  afterSend.entries.some((e) => e.billed && e.invoice?.id === invoiceId)
    ? ok('the ledger marks those lines billed, and names the invoice')
    : bad('billed projection', 'no entry carries the invoice')

  await rejects('a second sweep with nothing pending is refused', () =>
    billLocally(ocampo.stayId),
  )

  // THE SNAPSHOT, proved three ways. CLAUDE.md warns the next reader will
  // otherwise delete the invoice total as a violation of "the balance is
  // derived" — it is a different fact, and these say so.
  const beforeTotal = sent.totalCents
  const beforeBalance = afterSend.balanceCents
  await manager(`/residents/${ocampo.id}/ledger`, {
    method: 'POST',
    body: {
      type: 'CREDIT',
      amount: '30.00',
      description: 'Adjustment after invoicing',
    },
  })
  const afterCorrection = (await manager(`/residents/${ocampo.id}/ledger`)).body
  const invAfter = await runAsSystem(async () =>
    prisma.invoice.findUnique({ where: { id: invoiceId } }),
  )
  invAfter.totalCents === beforeTotal
    ? ok('a correction leaves the invoice total untouched — a snapshot, not a cache')
    : bad('snapshot holds', `${beforeTotal} → ${invAfter.totalCents}`)
  // It lands PENDING and does NOT move the balance. Under the old rule this
  // assertion read the other way round — the credit moved the balance at once.
  // Now nothing is owed or forgiven until an invoice says so, which is the
  // whole point: the correction flows onto the NEXT invoice.
  afterCorrection.pendingCents === -3000 && afterCorrection.balanceCents === beforeBalance
    ? ok('and it lands PENDING, leaving the balance alone until the next invoice')
    : bad(
        'correction pending',
        `pending ${afterCorrection.pendingCents}, balance ${beforeBalance}→${afterCorrection.balanceCents}`,
      )

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
      [invoiceId, ocampo.stayId],
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

  // ── Removing a pending charge ────────────────────────────────────────────
  // Nothing is deleted, ever. A removal is a reversing CREDIT and BOTH rows
  // stay; what it earns is that the pair stops being billable. The assertions
  // go in both directions because "pending dropped" passes just as well if the
  // charge were actually gone, which is the outcome this must NOT have.
  console.log('\n\x1b[1mRemoving a pending charge\x1b[0m')

  const marisol = find('Ferrer')
  const beforeRemove = (await manager(`/residents/${marisol.id}/ledger`)).body
  const target = beforeRemove.entries.find((e) => !e.billed && e.type === 'CHARGE')
  const rowsBefore = beforeRemove.entries.length

  const noReason = await manager(`/residents/${marisol.id}/ledger/${target.id}/remove`, {
    method: 'POST',
    body: {},
  })
  noReason.status === 400
    ? ok('a removal without a reason is refused — the pair is permanent evidence')
    : bad('reason required', noReason.status)

  const removed = await manager(`/residents/${marisol.id}/ledger/${target.id}/remove`, {
    method: 'POST',
    body: { reason: 'posted against the wrong resident' },
  })
  const afterRemove = (await manager(`/residents/${marisol.id}/ledger`)).body
  removed.status === 201 &&
  afterRemove.pendingCents === beforeRemove.pendingCents - target.amountCents
    ? ok('removing a pending charge drops it out of pending, to the cent')
    : bad(
        'pending drops',
        `${beforeRemove.pendingCents} → ${afterRemove.pendingCents} (charge ${target.amountCents})`,
      )
  afterRemove.balanceCents === beforeRemove.balanceCents
    ? ok('and the balance does not move — it was never owed, only pending')
    : bad('balance still', `${beforeRemove.balanceCents} → ${afterRemove.balanceCents}`)

  // The whole point of the append-only guarantee: MORE rows, not fewer.
  const kept = afterRemove.entries.find((e) => e.id === target.id)
  afterRemove.entries.length === rowsBefore + 1 && kept
    ? ok('both rows survive — the charge is still there, and so is its reversal')
    : bad('rows kept', `${rowsBefore} → ${afterRemove.entries.length}, original ${!!kept}`)
  kept?.removed === true && kept?.removedBy?.description?.includes('wrong resident')
    ? ok('the original carries its removal and the reason a manager typed')
    : bad('removal marked', JSON.stringify(kept?.removedBy))
  afterRemove.entries.some((e) => e.isReversal)
    ? ok('and the reversal is flagged, so the section can draw the pair as one line')
    : bad('reversal flagged', 'no entry carries isReversal')

  // The reason removal exists: neither half may reach the resident's invoice.
  const billable = (await manager('/invoices/billable')).body.stays
  const marisolRow = billable.find((s) => s.stayId === marisol.stayId)
  const stillPending = afterRemove.entries.filter(
    (e) => !e.billed && e.type !== 'PAYMENT' && !e.removed && !e.isReversal,
  )
  !marisolRow || marisolRow.lineCount === stillPending.length
    ? ok('the Friday run counts neither half — a removed charge never reaches Stripe')
    : bad('sweep excludes', `${marisolRow.lineCount} lines vs ${stillPending.length} live`)

  const twice = await manager(`/residents/${marisol.id}/ledger/${target.id}/remove`, {
    method: 'POST',
    body: { reason: 'again' },
  })
  twice.status === 409
    ? ok('removing the same charge twice is refused')
    : bad('double remove', twice.status)

  const billedEntry = afterRemove.entries.find((e) => e.billed && e.type === 'CHARGE')
  const invoiced = await manager(`/residents/${marisol.id}/ledger/${billedEntry.id}/remove`, {
    method: 'POST',
    body: { reason: 'too late' },
  })
  invoiced.status === 409
    ? ok('an INVOICED charge cannot be removed — that money has been demanded')
    : bad('billed refused', invoiced.status)

  const techRemove = await tech(`/residents/${marisol.id}/ledger/${target.id}/remove`, {
    method: 'POST',
    body: { reason: 'nope' },
  })
  techRemove.status === 403
    ? ok('a tech cannot remove a charge — they read a balance, never change one')
    : bad('tech refused', techRemove.status)

  // ── Void, draft, and money paid in advance ───────────────────────────────
  console.log('\n\x1b[1mThe edges of the new rule\x1b[0m')

  // VOIDING REMOVES THE DEMAND. That is why the balance is built from invoice
  // totals rather than from billed ledger lines — it is what gives a wrong
  // invoice a real undo. Its lines stay bound, so they still never re-bill.
  const beforeVoid = (await manager(`/residents/${ocampo.id}/ledger`)).body.balanceCents
  const voided = await admin(`/invoices/${invoiceId}/void`, {
    method: 'POST',
    body: { reason: 'probe — raised in error' },
  })
  const afterVoid = (await manager(`/residents/${ocampo.id}/ledger`)).body
  voided.status < 400 && afterVoid.balanceCents === beforeVoid - beforeTotal
    ? ok('voiding an invoice drops the balance by exactly its total')
    : bad('void drops it', `${beforeVoid} → ${afterVoid.balanceCents} (total ${beforeTotal})`)
  afterVoid.pendingCents === -3000
    ? ok("and its lines do NOT come back as pending — a void is not a re-bill")
    : bad('void does not unbill', afterVoid.pendingCents)

  // A DRAFT is in NEITHER figure — not pending (its lines are bound) and not
  // owed (nobody has been asked). Without its own figure that money simply
  // vanishes from every screen, which is the state a keyless send used to
  // leave behind.
  const ferrer = find('Ferrer')
  await postEntry(
    {
      stayId: ferrer.stayId,
      type: 'CHARGE',
      category: 'RENT',
      amountCents: 44400,
      description: 'Draft probe',
    },
    managerUser.id,
  )
  const draftInv = await runAsSystem(async () =>
    draftInvoice(ferrer.stayId, { dueAt: new Date() }, managerUser.id),
  )
  const withDraft = (await manager(`/residents/${ferrer.id}/ledger`)).body
  withDraft.draftCents === draftInv.invoice.totalCents &&
  withDraft.pendingCents === 0 &&
  withDraft.balanceCents === 0
    ? ok('a DRAFT is in neither figure, and is stated on its own so it cannot hide')
    : bad(
        'draft surfaced',
        `draft ${withDraft.draftCents}, pending ${withDraft.pendingCents}, balance ${withDraft.balanceCents}`,
      )

  // Money received before anything was invoiced reads as CREDIT, and nets
  // against the next invoice rather than being held aside invisibly.
  const joy = find('Nakamura')
  await manager(`/residents/${joy.id}/ledger`, {
    method: 'POST',
    body: { type: 'PAYMENT', amount: '200.00', description: 'Paid ahead at the desk' },
  })
  const prepaid = (await manager(`/residents/${joy.id}/ledger`)).body
  prepaid.balanceCents === -20000
    ? ok('a payment with nothing invoiced reads as a credit, not a hidden pot')
    : bad('prepayment credit', prepaid.balanceCents)

  await postEntry(
    {
      stayId: joy.stayId,
      type: 'CHARGE',
      category: 'RENT',
      amountCents: 65000,
      description: 'Rent — probe',
    },
    managerUser.id,
  )
  await billLocally(joy.stayId)
  const netted = (await manager(`/residents/${joy.id}/ledger`)).body
  netted.balanceCents === 45000
    ? ok('and it nets against the next invoice automatically ($650 billed − $200 held = $450)')
    : bad('credit nets', netted.balanceCents)

  // ── Overdue ──────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mOverdue is derived\x1b[0m')

  const castilloRecord = (await manager(`/residents/${castillo.residentId ?? castillo.id}`)).body
  castilloRecord.current?.invoices?.overdue === true
    ? ok('a seeded unpaid month reads overdue, and lights the record’s red dot')
    : bad('overdue derived', JSON.stringify(castilloRecord.current?.invoices))
  castilloRecord.current?.invoices?.dotDue === undefined
    ? ok('and there is no separate dotDue on the wire — the term IS the grace')
    : bad('dotDue gone', JSON.stringify(castilloRecord.current?.invoices?.dotDue))

  // ── The payment term ─────────────────────────────────────────────────────
  // The regression this section exists for: `dueAt` used to be the moment of
  // sending, and `overdue` is `dueAt < now`, so every invoice went overdue
  // about a second after it was sent. Asserted in BOTH directions, because
  // "a fresh invoice is not overdue" passes on its own if somebody sets the
  // term to a year, and "an old one is overdue" passed under the old bug too.
  console.log('\n\x1b[1mInvoices are net 3 days\x1b[0m')

  const { facilityDueDate, facilityToday } = await import('../src/lib/facilityTime.js')
  const { INVOICE_NET_DAYS } = await import('../src/domain/constants.js')

  const fresh = await billLocally(find('Whitfield').stayId, {
    dueAt: facilityDueDate(new Date(), INVOICE_NET_DAYS),
  })
  const freshRecord = (await manager(`/residents/${find('Whitfield').id}`)).body
  freshRecord.current?.invoices?.overdue === false
    ? ok('an invoice sent today is NOT overdue — the bug that started this')
    : bad('fresh not overdue', JSON.stringify(freshRecord.current?.invoices))

  // Its stored due date is three days out, not the moment of sending — proved
  // on FIXED instants so no DST week can make this flake. 6pm UTC on the 9th is
  // 2pm on the 9th in New York; 2:30am UTC on the 10th is 10:30pm on the 9th.
  // Both are the same facility day, so both are due at the end of the 12th.
  const midDay = facilityDueDate(new Date('2026-08-09T18:00:00Z'), INVOICE_NET_DAYS)
  const lateEve = facilityDueDate(new Date('2026-08-10T02:30:00Z'), INVOICE_NET_DAYS)
  facilityToday(midDay) === '2026-08-12'
    ? ok('the term lands on the END of the 3rd facility day, not 72 hours later')
    : bad('due date', facilityToday(midDay))
  lateEve.getTime() === midDay.getTime()
    ? ok('and two sends on the same facility day share a due date, whatever the hour')
    : bad('same day same due', `${lateEve.toISOString()} vs ${midDay.toISOString()}`)
  // The stored value came through draftInvoice, so the whole path is covered.
  facilityToday(new Date(fresh.dueAt)) !== facilityToday(new Date())
    ? ok('a real invoice stores that due date rather than the send moment')
    : bad('stored due date', fresh.dueAt)

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

  // A date the manager typed is a FACILITY calendar date. Pinned as a pure
  // check because the failure is invisible for most of the day: it only shows
  // up in the evening, when UTC has already rolled over and the facility has
  // not. `new Date('2026-08-06')` is UTC midnight, which is the 5th in New
  // York — so both directions are asserted, or a regression to the naive
  // parse would still pass the first one.
  const { facilityDayInstant } = await import('../src/lib/facilityTime.js')
  facilityToday(facilityDayInstant('2026-08-06')) === '2026-08-06' &&
  facilityToday(new Date('2026-08-06')) === '2026-08-05'
    ? ok('a hand-typed ledger date is read on the facility clock, not as UTC midnight')
    : bad('occurredAt date', facilityToday(facilityDayInstant('2026-08-06')))

  // 11pm ET on the 6th is already the 7th in UTC. A real instant must keep its
  // own facility day rather than being re-anchored to a calendar date.
  const lateEvening = new Date('2026-08-07T03:00:00Z')
  facilityDayInstant(lateEvening).getTime() === lateEvening.getTime() &&
  facilityToday(facilityDayInstant(lateEvening)) === '2026-08-06'
    ? ok("a payment's own instant passes through untouched and keeps its facility day")
    : bad('occurredAt instant', facilityDayInstant(lateEvening).toISOString())

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
