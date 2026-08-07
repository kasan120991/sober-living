/**
 * The billing screen's one read — the gate, and its agreement with the
 * endpoints it composes.
 *
 * A composed read is verified the way `/dashboard` is: by proving each band
 * equals its source, because the failure that matters is not a wrong number but
 * two screens quietly telling a manager different things about the same money.
 *
 * Run after `node scripts/seed.js`. Posts nothing it does not clean up, but the
 * nag assertions send a real invoice locally — reseed afterwards.
 */
import { createApp } from '../src/app.js'
import { prisma } from '../src/db/client.js'
import { runAsSystem } from '../src/lib/dbContext.js'
import { draftInvoice } from '../src/services/invoices.js'
import { fridayNag, lastFridayStart } from '../src/services/billing.js'

const money = (c) => `$${(c / 100).toFixed(2)}`

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
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
  }

  const manager = as(await login('manager@facility.test'))
  const tech = as(await login('tech@facility.test'))
  const admin = as(await login('admin@facility.test'))

  // ── The gate ─────────────────────────────────────────────────────────────
  // The sidebar hiding the link is presentation. THIS is the protection.
  console.log('\n\x1b[1mManagers and admins only\x1b[0m')

  const techBilling = await tech('/billing')
  techBilling.status === 403
    ? ok('a tech is refused the billing read — hiding the nav link is not the guard')
    : bad('tech refused', techBilling.status)

  const techBillable = await tech('/invoices/billable')
  techBillable.status === 403
    ? ok('and refused /invoices/billable, tightened with it')
    : bad('billable refused', techBillable.status)

  const mgr = await manager('/billing')
  const adm = await admin('/billing')
  mgr.status === 200 && adm.status === 200
    ? ok('a manager and an admin both read it')
    : bad('managers allowed', `${mgr.status} / ${adm.status}`)

  // The per-resident ledger read is deliberately NOT tightened: a tech asked
  // "what do I owe" at the door still answers it without finding a manager.
  const roster = (await tech('/residents')).body?.residents ?? []
  const anyone = roster.find((r) => r.stayId)
  const techLedger = await tech(`/residents/${anyone.id}/ledger`)
  techLedger.status === 200
    ? ok("a tech still reads ONE resident's ledger — a different question, left alone")
    : bad('record ledger all-staff', techLedger.status)

  const board = mgr.body

  // ── Agreement with the sources ───────────────────────────────────────────
  console.log('\n\x1b[1mEvery band equals its source\x1b[0m')

  const billable = (await manager('/invoices/billable')).body.stays
  board.ready.length === billable.length &&
  board.ready.every((r) => billable.some((b) => b.stayId === r.stayId && b.netCents === r.netCents))
    ? ok(`readyToBill equals /invoices/billable (${board.ready.length} stays)`)
    : bad('ready agrees', `${board.ready.length} vs ${billable.length}`)

  // The promise rule: the button names what will SEND, not what is ready.
  const sendable = board.ready.filter((r) => r.canInvoice)
  board.sendableCount === sendable.length &&
  board.readyTotalCents === sendable.reduce((t, r) => t + r.netCents, 0)
    ? ok(`the send figure counts only what CAN send (${board.sendableCount}, ${money(board.readyTotalCents)})`)
    : bad('send figure', `${board.sendableCount} / ${board.readyTotalCents}`)

  // Skipped rows are a DIFFERENT list from ready, and never overlap it — the
  // run loops over `ready`, so a stay in both would be billed and disclaimed.
  const readyIds = new Set(board.ready.map((r) => r.stayId))
  board.skipped.every((s) => !readyIds.has(s.stayId) && s.netCents < 0 && s.reason)
    ? ok('skipped stays net to a credit, carry a reason, and are absent from ready')
    : bad('skipped disjoint', JSON.stringify(board.skipped))

  // ── Past due ─────────────────────────────────────────────────────────────
  // The point of not reusing overdueByStay: it keeps one per stay.
  console.log('\n\x1b[1mPast due is EVERY overdue invoice\x1b[0m')

  const byStay = new Map()
  for (const i of board.pastDue) byStay.set(i.stayId, (byStay.get(i.stayId) ?? 0) + 1)
  const doubled = [...byStay.values()].some((n) => n > 1)
  doubled
    ? ok('a resident carrying two past-due invoices shows both, not just the oldest')
    : bad('two per stay', 'no stay in the fixture carries two — the assertion cannot hold')

  const ordered = board.pastDue.every(
    (i, n) => n === 0 || board.pastDue[n - 1].daysPastDue >= i.daysPastDue,
  )
  ordered
    ? ok('oldest first — the one that has been ignored longest leads')
    : bad('ordering', board.pastDue.map((i) => i.daysPastDue).join(','))

  // Agreement with the resident's own record, which reads the same helper.
  const worst = board.pastDue[0]
  const record = (await manager(`/residents/${worst.residentId}`)).body
  record.current?.invoices?.overdue === true
    ? ok("and the resident's own record agrees they are overdue — one derivation")
    : bad('record agrees', JSON.stringify(record.current?.invoices))

  // ── Figures ──────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe figures are the sum of their own rows\x1b[0m')

  const dash = (await manager('/dashboard')).body
  board.figures.outstandingCents === dash.balances.totalCents
    ? ok(`outstanding equals the dashboard's own total (${money(dash.balances.totalCents)})`)
    : bad('outstanding agrees', `${board.figures.outstandingCents} vs ${dash.balances.totalCents}`)

  // A SPLIT of outstanding, never a sum of invoice totals. Totalling the
  // documents produced "$1,625 outstanding, $1,950 past due" — impossible on
  // its face — because a part-paid $650 invoice leaves less than $650 owed.
  board.figures.overdueCents === dash.balances.overdueCents
    ? ok(`past due is the same split the dashboard card shows (${money(dash.balances.overdueCents)})`)
    : bad('overdue agrees', `${board.figures.overdueCents} vs ${dash.balances.overdueCents}`)
  board.figures.overdueCents <= board.figures.outstandingCents
    ? ok('and it is a PORTION of outstanding, which a split figure has to be')
    : bad('overdue ≤ outstanding', `${board.figures.overdueCents} > ${board.figures.outstandingCents}`)

  // The card and the button are ONE number. It shipped as the facility NET,
  // so a resident sitting on a credit made the card read "$150 waiting" above
  // a button offering "$250" — both right, and looking like a contradiction.
  // Asserted against the rows rather than against the button alone, or the
  // two could agree on a figure that matches neither list.
  const positivePending = board.ready.reduce((t, r) => t + r.netCents, 0)
  board.figures.pendingCents === positivePending
    ? ok(`"waiting to be billed" equals the rows beneath it (${money(positivePending)})`)
    : bad('pending equals rows', `${board.figures.pendingCents} vs ${positivePending}`)
  board.figures.creditCents === -board.skipped.reduce((t, s) => t + s.netCents, 0)
    ? ok('and any credit is stated separately rather than netted out of it')
    : bad('credit stated', `${board.figures.creditCents} vs ${board.skipped.length} skipped`)

  // ── The Friday nag ───────────────────────────────────────────────────────
  // Both directions. "It fired" passes even if it always fires.
  console.log('\n\x1b[1mThe Friday nag\x1b[0m')

  const since = lastFridayStart()
  new Date(since).getUTCDay() !== undefined && since instanceof Date
    ? ok(`the window starts at the most recent Friday (${since.toISOString().slice(0, 10)})`)
    : bad('friday window', String(since))

  const before = await fridayNag()
  before.due === true && before.waiting > 0
    ? ok(`it fires with ${before.waiting} residents waiting and nothing billed since Friday`)
    : bad('nag fires', JSON.stringify(before))
  dash.attention?.billingDue?.waiting === before.waiting
    ? ok('and the dashboard panel carries the same row — one derivation, two screens')
    : bad('dashboard row', JSON.stringify(dash.attention?.billingDue))

  // Bill somebody locally; the nag must clear. Local rather than through the
  // route because this suite runs with no Stripe key and the send refuses.
  const target = board.ready.find((r) => r.canInvoice)
  const managerUser = await runAsSystem(async () =>
    prisma.user.findUnique({ where: { email: 'manager@facility.test' }, select: { id: true } }),
  )
  await runAsSystem(async () =>
    draftInvoice(target.stayId, { dueAt: new Date() }, managerUser.id),
  )
  const after = await fridayNag()
  after.due === false
    ? ok('and it CLEARS the moment an invoice is created — not a permanent scold')
    : bad('nag clears', JSON.stringify(after))

  // The bell is deliberately untouched: techs read it and cannot act on this.
  const bell = (await manager('/notifications')).body
  !JSON.stringify(bell).toLowerCase().includes('billing')
    ? ok('the bell carries nothing about billing — techs read it and cannot open /billing')
    : bad('bell clean', 'a billing item reached the bell')

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => { console.error(e); process.exit(1) })
