import { prisma } from '../db/client.js'
import { STAY_STATUS } from '../domain/constants.js'
import { facilityToday, facilityWallClockToUtc } from '../lib/facilityTime.js'
import { balancesByStay, draftByStay, pendingByStay } from './ledger.js'
import { billableStays, overdueInvoices } from './invoices.js'

/**
 * The billing screen's one read.
 *
 * Composed entirely from the derivations the rest of the app already uses —
 * `billableStays`, `overdueInvoices`, `balancesByStay`, `pendingByStay`,
 * `draftByStay` — for the same reason `/dashboard` is: a screen rendered from
 * one request cannot show two halves that disagree because one loaded a second
 * later, and a figure here cannot drift from the resident record it came from.
 *
 * MANAGERS AND ADMINS ONLY, enforced on the route. This is the facility's money
 * in aggregate, which is a different question from the one the record answers —
 * a tech asked "what do I owe" at the door still reads a single balance there,
 * and that read is deliberately unchanged.
 */

/** Every stay whose money this screen is about. */
async function activeStayIds() {
  const stays = await prisma.stay.findMany({
    where: { status: STAY_STATUS.ACTIVE },
    select: { id: true },
  })
  return stays.map((s) => s.id)
}

/**
 * Active stays holding pending money that the run will NOT bill because it
 * nets to a CREDIT.
 *
 * `billableStays()` drops these on purpose — it is the list the weekly run
 * loops over, and a sweep must come out positive or it creates nothing. They
 * are still worth showing: a resident with lines waiting that will never bill
 * is money that quietly goes uncollected, and a manager can act on knowing why.
 *
 * Note the OTHER reason a stay cannot be billed — no email on file — does not
 * appear here. Those stays ARE in `ready`, carrying `canInvoice: false`, since
 * they have positive pending; the screen groups them from that flag. Two
 * sources for "will not send" would be two lists to keep in step.
 */
async function creditStays(billableIds) {
  const ids = await activeStayIds()
  const pending = await pendingByStay(ids)
  const wanted = ids.filter((id) => !billableIds.has(id) && (pending.get(id) ?? 0) < 0)
  if (!wanted.length) return []

  const stays = await prisma.stay.findMany({
    where: { id: { in: wanted } },
    select: { id: true, resident: { select: { id: true, firstName: true, lastName: true } } },
  })
  return stays.map((stay) => ({
    stayId: stay.id,
    residentId: stay.resident.id,
    residentName: `${stay.resident.firstName} ${stay.resident.lastName}`,
    netCents: pending.get(stay.id) ?? 0,
    reason: 'CREDIT',
  }))
}

/**
 * The most recent Friday on the FACILITY calendar, at 00:00 facility time.
 *
 * Date-key arithmetic, never `n * 86_400_000` on an instant — across a DST
 * boundary that lands on the wrong day. Same rule as `addDays` and
 * `facilityDueDate`.
 */
export function lastFridayStart(now = new Date()) {
  const key = facilityToday(now)
  const d = new Date(`${key}T00:00:00.000Z`)
  // getUTCDay: 0 Sun … 5 Fri. Today counts if today IS Friday.
  const back = (d.getUTCDay() - 5 + 7) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return facilityWallClockToUtc(d.toISOString().slice(0, 10), '00:00')
}

/**
 * The Friday nag — the honest counterweight to having no cron.
 *
 * Fires when there is money pending ANYWHERE and no invoice has been created
 * since the most recent Friday. Deliberately NOT "there are pending charges",
 * which is true every day and would be exactly the noisy dot CLAUDE.md warns
 * about twice; the point is that a billing day went past unbilled.
 *
 * It matters more than it did: since 2026-08-07 pending money sits outside the
 * balance, so forgetting the button means nobody shows as owing it at all.
 */
export async function fridayNag(now = new Date()) {
  const since = lastFridayStart(now)
  const [pendingTotal, invoiced] = await Promise.all([
    pendingByStay(await activeStayIds()),
    prisma.invoice.count({ where: { createdAt: { gte: since } } }),
  ])
  // A COUNT of residents, not an amount — deliberately. The screen's own
  // "pending" figure is the facility NET, which includes a resident sitting on
  // a credit; the number of people with billable work waiting is a different
  // quantity, and quoting a second money figure under the same word is how a
  // row and the card above it come to look like they disagree. The panel's
  // rows are situations anyway, not totals.
  const waiting = [...pendingTotal.values()].filter((c) => c > 0).length
  return { due: waiting > 0 && invoiced === 0, since, waiting }
}

/** Everything the billing screen draws. One read. */
export async function billingBoard() {
  const ids = await activeStayIds()
  const [ready, pastDue, balances, pending, drafts, recent, nag] = await Promise.all([
    billableStays(),
    overdueInvoices(),
    balancesByStay(ids),
    pendingByStay(ids),
    draftByStay(ids),
    prisma.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        stay: {
          select: { resident: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    }),
    fridayNag(),
  ])

  const billableIds = new Set(ready.map((r) => r.stayId))
  const skipped = await creditStays(billableIds)

  const sum = (map, only = () => true) =>
    [...map.values()].reduce((t, c) => t + (only(c) ? c : 0), 0)

  return {
    figures: {
      // Outstanding counts only what somebody OWES; a credit balance is not
      // negative outstanding, it is a different fact — the dashboard panel's
      // own rule, so the two cannot disagree.
      outstandingCents: sum(balances, (c) => c > 0),
      // The BALANCE of stays carrying an overdue invoice, not the sum of those
      // invoices' totals — the dashboard card's rule, and it has to be, or the
      // split reads as impossible: a resident part-paid a $650 invoice owes
      // less than $650, and totalling the documents produced "$1,625
      // outstanding, $1,950 past due". This is a portion of outstanding by
      // construction, which is what a split figure has to be.
      overdueCents: [...new Set(pastDue.map((i) => i.stayId))].reduce(
        (t, stayId) => t + Math.max(0, balances.get(stayId) ?? 0),
        0,
      ),
      pendingCents: sum(pending),
      draftCents: [...drafts.values()].reduce((t, d) => t + d.cents, 0),
      draftCount: [...drafts.values()].reduce((t, d) => t + d.count, 0),
    },
    // What the button will actually send, and what it will not.
    ready,
    skipped,
    readyTotalCents: ready.reduce((t, s) => t + (s.canInvoice ? s.netCents : 0), 0),
    sendableCount: ready.filter((s) => s.canInvoice).length,
    pastDue,
    recent: recent.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      totalCents: i.totalCents,
      dueAt: i.dueAt,
      createdAt: i.createdAt,
      hostedUrl: i.hostedUrl,
      residentId: i.stay.resident.id,
      residentName: `${i.stay.resident.firstName} ${i.stay.resident.lastName}`,
    })),
    nag,
  }
}
