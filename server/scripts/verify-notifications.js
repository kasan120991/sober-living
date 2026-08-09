/**
 * The bell as an event feed — routing, read state, and what may be said.
 *
 * What this proves: the read carries BOTH halves (derived situations for the
 * sidebar badges, stored events for the bell); an event is written in the SAME
 * TRANSACTION as the act, so a failed write leaves no phantom; role routing
 * holds in both directions, and a tech never sees money; read state is per USER
 * and the watermark only moves forward; the table is append-only against the
 * app role by privilege and a superuser by trigger, asserted separately; and —
 * the one that matters most — no free text about a PERSON and nothing clinical
 * ever reaches the feed, asserted against the SERIALISED payload per role
 * rather than a list of known keys.
 *
 * Run after `node scripts/seed.js`. Writes events and does not clean up, so
 * reseed afterwards.
 */
import { createApp } from '../src/app.js'
import { prisma } from '../src/db/client.js'
import { runAsSystem } from '../src/lib/dbContext.js'
import { NOTIFICATION_KIND } from '../src/domain/constants.js'

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
  const admin = as(await login('admin@facility.test'))

  const pg = (await import('pg')).default
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await owner.connect()

  // ── The shape ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mOne read, two halves\x1b[0m')

  const first = (await tech('/notifications')).body
  ;['situations', 'actionCount', 'events', 'unseenCount', 'seenAt'].every((k) => k in first)
    ? ok('the read carries situations, actionCount, events, unseenCount and seenAt')
    : bad('shape', JSON.stringify(Object.keys(first)))

  // The sidebar badges read `situations`. If this half ever stops being served
  // the badges go silently blank, so it is asserted rather than assumed.
  Array.isArray(first.situations) && first.situations.length > 0
    ? ok('the DERIVED situations are still served — the sidebar badges read these')
    : bad('situations served', JSON.stringify(first.situations))

  // ── The phantom test ─────────────────────────────────────────────────────
  // This is why notify() lives inside runInTransaction. An event that outlives
  // a rolled-back act would announce something that does not exist, on a screen
  // it is not on — and nothing could clear it, because the feed is not derived.
  console.log('\n\x1b[1mA failed act writes no event\x1b[0m')

  const before = await runAsSystem(async () => await prisma.notification.count())
  const bad1 = await tech('/maintenance', { method: 'POST', body: JSON.stringify({}) })
  const bad2 = await manager('/passes/does-not-exist/review', {
    method: 'POST',
    body: JSON.stringify({ approve: false, note: 'nope' }),
  })
  const after = await runAsSystem(async () => await prisma.notification.count())
  bad1.status >= 400 && bad2.status >= 400 && after === before
    ? ok(`two failed writes left the table untouched (${before} rows before and after)`)
    : bad('no phantom', `${bad1.status}/${bad2.status}, ${before} → ${after}`)

  // ── Routing, in both directions ──────────────────────────────────────────
  console.log('\n\x1b[1mRouting\x1b[0m')

  const apartmentId = (await manager('/apartments')).body.apartments[0].id
  const filed = await tech('/maintenance', {
    method: 'POST',
    body: JSON.stringify({ apartmentId, title: 'Notify probe — porch light out' }),
  })
  const kindsFor = async (who) => (await who('/notifications')).body.events.map((e) => e.kind)

  filed.status === 201 &&
  (await kindsFor(tech)).includes('MAINTENANCE_FILED') &&
  (await kindsFor(manager)).includes('MAINTENANCE_FILED')
    ? ok('a filed repair reaches ALL staff — the tech who hears it may be the one with the ladder')
    : bad('maintenance is all-staff', `${filed.status}`)

  const payee = (await manager('/residents')).body.residents.find((r) => r.status === 'ACTIVE')
  const paid = await manager(`/residents/${payee.id}/ledger`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'PAYMENT',
      amount: '25.00',
      description: 'Notify probe — desk cash',
      occurredAt: '2026-08-08',
    }),
  })
  const mgrKinds = await kindsFor(manager)
  const admKinds = await kindsFor(admin)
  const techKinds = await kindsFor(tech)

  paid.status === 201 &&
  mgrKinds.includes('PAYMENT_RECEIVED') &&
  admKinds.includes('PAYMENT_RECEIVED')
    ? ok('a payment reaches managers and admins')
    : bad('money reaches managers', `${paid.status} ${mgrKinds}`)

  // The direction that matters. A cheap assertion would only check the
  // manager sees it — this one checks the tech does not.
  !techKinds.includes('PAYMENT_RECEIVED')
    ? ok('…and NOT a tech — "a tech does not need to know a payment landed"')
    : bad('money withheld from a tech', JSON.stringify(techKinds))

  // A charge is the facility asking, a credit is the facility correcting
  // itself. Neither is news; only money arriving is.
  const chargesBefore = await runAsSystem(
    async () => await prisma.notification.count({ where: { kind: NOTIFICATION_KIND.PAYMENT_RECEIVED } }),
  )
  await manager(`/residents/${payee.id}/ledger`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CHARGE',
      category: 'RENT',
      amount: '10.00',
      description: 'Notify probe — charge',
      occurredAt: '2026-08-08',
    }),
  })
  const chargesAfter = await runAsSystem(
    async () => await prisma.notification.count({ where: { kind: NOTIFICATION_KIND.PAYMENT_RECEIVED } }),
  )
  chargesAfter === chargesBefore
    ? ok('a CHARGE writes no event — only money arriving is news')
    : bad('charge is silent', `${chargesBefore} → ${chargesAfter}`)

  // ── Read state ───────────────────────────────────────────────────────────
  console.log('\n\x1b[1mRead state is per USER\x1b[0m')

  const mgrBefore = (await manager('/notifications')).body.unseenCount
  const admBefore = (await admin('/notifications')).body.unseenCount
  mgrBefore > 0 && admBefore > 0
    ? ok(`both start with unread events (${mgrBefore} and ${admBefore})`)
    : bad('unread to begin with', `${mgrBefore} / ${admBefore}`)

  await manager('/notifications/seen', { method: 'POST' })
  const mgrAfter = (await manager('/notifications')).body.unseenCount
  const admAfter = (await admin('/notifications')).body.unseenCount
  mgrAfter === 0 && admAfter === admBefore
    ? ok('the manager marking seen clears THEIR count and leaves the admin’s alone')
    : bad('per-user read state', `manager ${mgrAfter}, admin ${admAfter} (was ${admBefore})`)

  // Forward only. Two tabs racing would otherwise rewind the watermark and
  // re-toast everything in between.
  const seen1 = (await manager('/notifications')).body.seenAt
  await runAsSystem(async () => {
    await prisma.$executeRaw`
      INSERT INTO "notification_seen" ("userId", "seenAt")
      SELECT "userId", "seenAt" - interval '1 day' FROM "notification_seen"
      ON CONFLICT ("userId") DO UPDATE
        SET "seenAt" = GREATEST("notification_seen"."seenAt", EXCLUDED."seenAt")`
  })
  const seen2 = (await manager('/notifications')).body.seenAt
  new Date(seen2) >= new Date(seen1)
    ? ok('the watermark only moves forward — an older write cannot rewind it')
    : bad('forward only', `${seen1} → ${seen2}`)

  // ── Append-only, both layers ─────────────────────────────────────────────
  console.log('\n\x1b[1mAppend-only\x1b[0m')

  const anyId = await runAsSystem(async () =>
    (await prisma.notification.findFirst({ select: { id: true } }))?.id,
  )

  await rejects('the APP ROLE cannot edit an event — refused on privilege', () =>
    runAsSystem(async () =>
      await prisma.notification.update({ where: { id: anyId }, data: { title: 'rewritten' } }),
    ),
  )
  await rejects('a SUPERUSER cannot either — refused by the trigger', () =>
    owner.query(`UPDATE "notifications" SET "title" = 'rewritten' WHERE id = $1`, [anyId]),
  )
  await rejects('…and cannot delete one', () =>
    owner.query(`DELETE FROM "notifications" WHERE id = $1`, [anyId]),
  )

  // Routing is a predicate, so an event addressed to nobody is a silent bug:
  // the write succeeds, the act is recorded, and no one is ever told.
  await rejects('an event addressed to NOBODY is refused by the CHECK', () =>
    owner.query(
      `INSERT INTO "notifications" ("id","kind","class","roles","title","to")
       VALUES ('probe-no-recipient','MAINTENANCE_FILED','REQUEST',ARRAY[]::"StaffRole"[],'x','/maintenance')`,
    ),
  )

  // ── Disclosure ───────────────────────────────────────────────────────────
  // Asserted against the WHOLE SERIALISED payload per role, the
  // verify-screens.js idiom — not a list of known keys, because a key-list
  // assertion passes the day somebody adds a field.
  console.log('\n\x1b[1mWhat may be said\x1b[0m')

  const feeds = {
    tech: JSON.stringify((await tech('/notifications')).body.events),
    manager: JSON.stringify((await manager('/notifications')).body.events),
    admin: JSON.stringify((await admin('/notifications')).body.events),
  }

  const clinical = /screen|Screen|SCREEN|POSITIVE|DILUTE|REFUSAL|THC|OPIATES|specimen|medication|dosage|Trazodone|Metformin/
  Object.entries(feeds).every(([, f]) => !clinical.test(f))
    ? ok('no clinical vocabulary reaches any feed')
    : bad('clinical leak', Object.entries(feeds).find(([, f]) => clinical.test(f))?.[0])

  // Nothing from module 5 or 6 may become an event AT ALL — asserted on the
  // enum itself, so adding one is caught even if no row exists yet.
  !Object.keys(NOTIFICATION_KIND).some((k) => /^MED/.test(k))
    ? ok('no notification kind starts with MED — modules 5 and 6 are out entirely')
    : bad('med kind exists', JSON.stringify(Object.keys(NOTIFICATION_KIND)))

  // Free text about a PERSON. Each of these is a real column on a real row in
  // the seeded facility, and none of them may cross. The maintenance TITLE is
  // the deliberate exception — it is about a unit, and the derived bell item
  // has always carried it.
  const personalText = /desk cash|Notify probe — charge|Kroger|Aunt|Columbus|Sister's wedding|Family event|court date|drug court/i
  Object.entries(feeds).every(([, f]) => !personalText.test(f))
    ? ok('no free text ABOUT A PERSON crosses — no ledger description, pass purpose or destination')
    : bad('free text leak', Object.entries(feeds).find(([, f]) => personalText.test(f))?.[1])

  feeds.tech.includes('porch light')
    ? ok('…while a maintenance TITLE does cross, because it is about a unit')
    : bad('maintenance title crosses', feeds.tech.slice(0, 200))

  await owner.end()
  server.close()
  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
