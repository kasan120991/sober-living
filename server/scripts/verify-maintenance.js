/**
 * Maintenance — the target rule, the owner, and the trail.
 *
 * What this proves: a request is late against its OWN priority's target, and
 * that rule is one pure function the page, the bell and the dashboard all
 * derive through; IN_PROGRESS cannot exist without an owner, enforced by the
 * database and not merely by a service; closing requires a note at the route
 * AND at a CHECK; closing and reopening APPEND, so a request closed twice can
 * still show its first closure — the fault that motivated the whole table,
 * since reopening used to clear resolvedBy/resolvedAt/resolutionNote outright;
 * the trail is append-only against the app role (privilege) and a superuser
 * (trigger), asserted separately; raising a priority is all-staff while
 * lowering it is managers; and a bad query string is a 400 rather than a 500.
 *
 * Biased toward the assertions whose cheap half passes anyway. "The trail
 * shows the latest closure" would pass with the first one destroyed, so the
 * assertion is that the row COUNT GOES UP and the first note is still legible.
 *
 * Run after `node scripts/seed.js`. Posts requests and closes them, and does
 * not clean up, so reseed afterwards.
 */
import { createApp } from '../src/app.js'
import { prisma } from '../src/db/client.js'
import { runAsSystem } from '../src/lib/dbContext.js'
import {
  MAINTENANCE_STATE,
  bellMaintenanceWhere,
  dueAt,
  overdueRequestWhere,
  requestState,
  urgentOpenWhere,
} from '../src/services/maintenance.js'
import { MAINTENANCE_TARGET_MS } from '../src/domain/constants.js'

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

const HOUR = 3_600_000
const DAY = 24 * HOUR

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

  // The owner connection, for what only a superuser can prove: that the
  // triggers and CHECKs hold against direct SQL. Raw SQL through the app
  // client cannot stand in — with no actor context the statement matches zero
  // rows, and that looks like a pass while testing nothing.
  const pg = (await import('pg')).default
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await owner.connect()

  const seed = await runAsSystem(async () => {
    const apt = await prisma.apartment.findFirst({ where: { name: 'Apt 12' } })
    const techUser = await prisma.user.findFirst({ where: { email: 'tech@facility.test' } })
    return { aptId: apt.id, techId: techUser.id }
  })

  /** A request at a chosen age, straight into the table. */
  const aged = (priority, ageMs, extra = {}) =>
    runAsSystem(async () =>
      prisma.maintenanceRequest.create({
        data: {
          apartmentId: seed.aptId,
          title: `probe ${priority} ${ageMs}ms ${Math.round(Math.random() * 1e6)}`,
          priority,
          reportedById: seed.techId,
          reportedAt: new Date(Date.now() - ageMs),
          ...extra,
        },
      }),
    )

  // ── The gate ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe gate\x1b[0m')

  const anon = await fetch(`${base}/maintenance`)
  anon.status === 401 ? ok('anonymous is refused') : bad('anon 401', anon.status)

  const techList = await tech('/maintenance')
  techList.status === 200
    ? ok('a tech reads the list — filing a repair is all-staff work')
    : bad('tech reads list', techList.status)

  const techHouse = await tech('/maintenance/house')
  techHouse.status === 200
    ? ok('a tech reads the composed page read')
    : bad('tech reads /house', techHouse.status)

  // The failure this replaced: `?status=FOO` reached a Prisma enum and came
  // back a 500, where every other bad input in this app is a 400.
  const badStatus = await manager('/maintenance?status=FOO')
  badStatus.status === 400
    ? ok('an unknown ?status is a 400, not a 500')
    : bad('bad status 400', badStatus.status)

  const badPriority = await manager('/maintenance?priority=BOGUS')
  badPriority.status === 400
    ? ok('an unknown ?priority is a 400')
    : bad('bad priority 400', badPriority.status)

  const openOnly = await manager('/maintenance?status=open')
  openOnly.body.requests.every((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS')
    ? ok('?status=open means both live states')
    : bad('status=open', 'a closed request came back')

  // ── The target rule, with no database ────────────────────────────────────
  console.log('\n\x1b[1mThe target rule (pure)\x1b[0m')

  const at = (priority, ageMs) =>
    requestState({ status: 'OPEN', priority, reportedAt: new Date(Date.now() - ageMs) })

  at('URGENT', 23 * HOUR) === MAINTENANCE_STATE.OPEN
    ? ok('urgent at 23h is OPEN')
    : bad('urgent 23h', at('URGENT', 23 * HOUR))
  at('URGENT', 25 * HOUR) === MAINTENANCE_STATE.OVERDUE
    ? ok('urgent at 25h is OVERDUE — the 24h target')
    : bad('urgent 25h', at('URGENT', 25 * HOUR))
  at('NORMAL', 6 * DAY) === MAINTENANCE_STATE.OPEN
    ? ok('normal at 6 days is OPEN')
    : bad('normal 6d', at('NORMAL', 6 * DAY))
  at('NORMAL', 8 * DAY) === MAINTENANCE_STATE.OVERDUE
    ? ok('normal at 8 days is OVERDUE — the 7 day target')
    : bad('normal 8d', at('NORMAL', 8 * DAY))
  at('LOW', 29 * DAY) === MAINTENANCE_STATE.OPEN
    ? ok('low at 29 days is OPEN')
    : bad('low 29d', at('LOW', 29 * DAY))
  at('LOW', 31 * DAY) === MAINTENANCE_STATE.OVERDUE
    ? ok('low at 31 days is OVERDUE — the 30 day target')
    : bad('low 31d', at('LOW', 31 * DAY))

  // A closed request is never overdue however old. Without this, every
  // resolved request in the facility's history would light up.
  requestState({ status: 'RESOLVED', priority: 'URGENT', reportedAt: new Date(0) }) ===
  MAINTENANCE_STATE.CLOSED
    ? ok('a closed request is CLOSED however old it is')
    : bad('closed never overdue', 'a resolved request read as overdue')

  const anchor = new Date(Date.now() - 3 * HOUR)
  dueAt({ status: 'OPEN', priority: 'URGENT', reportedAt: anchor }).getTime() ===
  anchor.getTime() + MAINTENANCE_TARGET_MS.URGENT
    ? ok('dueAt is reportedAt plus that priority’s target, exactly')
    : bad('dueAt', 'the due instant is not reportedAt + target')

  dueAt({ status: 'RESOLVED', priority: 'URGENT', reportedAt: anchor }) === null
    ? ok('a closed request has no due instant')
    : bad('dueAt closed', 'a closed request carried a due instant')

  // ── The union, in both directions ────────────────────────────────────────
  console.log('\n\x1b[1mUrgent-or-overdue, both directions\x1b[0m')

  const freshUrgent = await aged('URGENT', 2 * HOUR)
  const staleNormal = await aged('NORMAL', 9 * DAY)
  const freshNormal = await aged('NORMAL', 1 * HOUR)

  const overdueIds = await runAsSystem(async () =>
    prisma.maintenanceRequest.findMany({ where: overdueRequestWhere(), select: { id: true } }),
  ).then((rs) => new Set(rs.map((r) => r.id)))
  const urgentIds = await runAsSystem(async () =>
    prisma.maintenanceRequest.findMany({ where: urgentOpenWhere(), select: { id: true } }),
  ).then((rs) => new Set(rs.map((r) => r.id)))
  const bellIds = await runAsSystem(async () =>
    prisma.maintenanceRequest.findMany({ where: bellMaintenanceWhere(), select: { id: true } }),
  ).then((rs) => new Set(rs.map((r) => r.id)))

  // This pair is the whole reason urgentOpenWhere() survived the target rule
  // rather than being replaced by it.
  !overdueIds.has(freshUrgent.id) && bellIds.has(freshUrgent.id)
    ? ok('an urgent request two hours old is NOT overdue, and is in the bell anyway')
    : bad('fresh urgent', 'the fresh urgent request was misclassified')

  overdueIds.has(staleNormal.id) && bellIds.has(staleNormal.id)
    ? ok('a normal request nine days old IS overdue, and reaches the bell')
    : bad('stale normal', 'the aged normal request did not surface')

  !overdueIds.has(freshNormal.id) && !bellIds.has(freshNormal.id)
    ? ok('a normal request an hour old is in neither — the bell stays quiet')
    : bad('fresh normal', 'a young normal request surfaced')

  const union = new Set([...overdueIds, ...urgentIds])
  union.size === bellIds.size && [...union].every((id) => bellIds.has(id))
    ? ok('the bell’s set is exactly urgent-open ∪ overdue — one knob, no third rule')
    : bad('union', `${union.size} in the union vs ${bellIds.size} in the bell`)

  // ── Agreement across surfaces ────────────────────────────────────────────
  console.log('\n\x1b[1mThe bell and the dashboard agree\x1b[0m')

  const notif = await manager('/notifications')
  const notifIds = new Set(
    notif.body.situations.filter((i) => i.kind === 'URGENT_MAINTENANCE').map((i) => i.id.slice(7)),
  )
  notifIds.size === bellIds.size && [...notifIds].every((id) => bellIds.has(id))
    ? ok('every bell item is exactly one row of the shared where')
    : bad('bell agreement', `${notifIds.size} bell items vs ${bellIds.size} rows`)

  const dash = await manager('/dashboard')
  const dashIds = new Set(dash.body.attention.urgentMaintenance.map((r) => r.id))
  dashIds.size === bellIds.size && [...dashIds].every((id) => bellIds.has(id))
    ? ok('the dashboard panel names the same requests as the bell')
    : bad('dashboard agreement', `${dashIds.size} vs ${bellIds.size}`)

  dash.body.attention.urgentMaintenance.every((r) => r.state && r.priority)
    ? ok('the panel carries state and priority, so the client need not re-derive the rule')
    : bad('panel fields', 'state or priority missing')

  // The bell's own version of that rule, added for the sidebar badge (2026-08-08).
  // URGENT_MAINTENANCE is the ONE kind whose urgency a client cannot derive —
  // the item carries neither priority nor reportedAt — so without this field the
  // only way to tell an overdue repair from a merely urgent one was parsing the
  // `detail` sentence. Asserted per item AND in both directions, because "they
  // all say critical" would pass while the distinction was gone.
  const sevItems = notif.body.situations.filter((i) => i.kind === 'URGENT_MAINTENANCE')
  sevItems.every((i) =>
    overdueIds.has(i.id.slice(7)) ? i.severity === 'critical' : i.severity === 'warning',
  )
    ? ok('each bell item’s severity IS its own overdue-ness — nothing downstream parses the detail')
    : bad('bell severity', JSON.stringify(sevItems.map((i) => [i.id, i.severity])))

  // The seed carries both kinds, so this proves the field actually discriminates
  // rather than being a constant that happens to satisfy the check above.
  new Set(sevItems.map((i) => i.severity)).size === 2
    ? ok('…and both values are really in play — an overdue one and a merely urgent one')
    : bad('severity discriminates', JSON.stringify(sevItems.map((i) => i.severity)))

  // ── IN_PROGRESS needs an owner ───────────────────────────────────────────
  console.log('\n\x1b[1mIN_PROGRESS carries an owner\x1b[0m')

  const ownerless = await aged('NORMAL', 1 * HOUR)
  await rejects('a SUPERUSER cannot set IN_PROGRESS with no owner (CHECK)', () =>
    owner.query(`UPDATE "maintenance_requests" SET "status"='IN_PROGRESS' WHERE id = $1`, [
      ownerless.id,
    ]),
  )
  // The issue #1 hole in its maintenance costume: length(btrim(NULL)) is NULL,
  // NULL OR FALSE is NULL, and a CHECK passes on NULL. Without the explicit
  // IS NOT NULL on the vendor branch, this write would land.
  await rejects('a NULL vendor name does not satisfy the owner CHECK', () =>
    owner.query(
      `UPDATE "maintenance_requests" SET "status"='IN_PROGRESS', "vendorName"=NULL WHERE id = $1`,
      [ownerless.id],
    ),
  )
  await rejects('a BLANK vendor name does not satisfy it either', () =>
    owner.query(
      `UPDATE "maintenance_requests" SET "status"='IN_PROGRESS', "vendorName"='   ' WHERE id = $1`,
      [ownerless.id],
    ),
  )

  const taken = await tech(`/maintenance/${ownerless.id}/start`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  taken.status === 200 && taken.body.assignedTo?.id === seed.techId
    ? ok('a tech taking a job with no body is assigned it — one tap in a hallway')
    : bad('start defaults to actor', JSON.stringify(taken.body)?.slice(0, 120))

  const vendored = await aged('NORMAL', 1 * HOUR)
  const withVendor = await manager(`/maintenance/${vendored.id}/start`, {
    method: 'POST',
    body: JSON.stringify({ vendorName: 'Ridgeway Glazing', workOrderRef: '901' }),
  })
  withVendor.status === 200 &&
  withVendor.body.vendorName === 'Ridgeway Glazing' &&
  withVendor.body.assignedTo === null
    ? ok('naming a vendor leaves the assignee empty — the two are not the same fact')
    : bad('vendor start', JSON.stringify(withVendor.body)?.slice(0, 120))

  // ── Closing ──────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mClosing requires a note\x1b[0m')

  const toClose = await aged('NORMAL', 2 * HOUR)

  const noNote = await manager(`/maintenance/${toClose.id}/close`, {
    method: 'POST',
    body: JSON.stringify({ status: 'RESOLVED', note: '   ' }),
  })
  noNote.status === 400
    ? ok('closing with a blank note is refused at the route')
    : bad('route refuses blank note', noNote.status)

  // The rule lived ONLY in a service function until 2026-08-07, so any other
  // code path could close a request silently. Now the database refuses it.
  await rejects('a SUPERUSER cannot append a closure with a blank note (CHECK)', () =>
    owner.query(
      `INSERT INTO "maintenance_events" (id,"requestId",kind,"closedAs",note,"actorId")
       VALUES ('probe-blank',$1,'CLOSED','RESOLVED','  ',$2)`,
      [toClose.id, seed.techId],
    ),
  )
  await rejects('a REOPENED row may not carry a closedAs (CHECK)', () =>
    owner.query(
      `INSERT INTO "maintenance_events" (id,"requestId",kind,"closedAs",note,"actorId")
       VALUES ('probe-pair',$1,'REOPENED','RESOLVED','why',$2)`,
      [toClose.id, seed.techId],
    ),
  )

  const closed = await manager(`/maintenance/${toClose.id}/close`, {
    method: 'POST',
    body: JSON.stringify({ status: 'RESOLVED', note: 'First fix — tightened the bracket.' }),
  })
  closed.status === 200 && closed.body.events.length === 1 && closed.body.status === 'RESOLVED'
    ? ok('closing appends exactly one event and sets the status')
    : bad('close', JSON.stringify(closed.body)?.slice(0, 140))

  closed.body.closure?.note === 'First fix — tightened the bracket.'
    ? ok('the closure in force is read off the trail, not off a column')
    : bad('closure derived', JSON.stringify(closed.body.closure))

  const twice = await manager(`/maintenance/${toClose.id}/close`, {
    method: 'POST',
    body: JSON.stringify({ status: 'RESOLVED', note: 'again' }),
  })
  twice.status === 409 ? ok('closing an already-closed request is a 409') : bad('double close', twice.status)

  // ── The trail survives a reopening ───────────────────────────────────────
  console.log('\n\x1b[1mThe trail: closed, reopened, closed\x1b[0m')

  const reopened = await manager(`/maintenance/${toClose.id}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ note: 'Came loose again inside a week.' }),
  })
  reopened.status === 200 && reopened.body.status === 'OPEN'
    ? ok('reopening returns the request to OPEN')
    : bad('reopen', JSON.stringify(reopened.body)?.slice(0, 120))

  reopened.body.closure === null
    ? ok('a reopened request has no closure in force')
    : bad('closure cleared', 'a reopened request still reported a closure')

  const reclosed = await manager(`/maintenance/${toClose.id}/close`, {
    method: 'POST',
    body: JSON.stringify({ status: 'RESOLVED', note: 'Replaced the bracket outright.' }),
  })

  // THE assertion. "The trail shows the latest closure" passes even if the
  // first one was destroyed — which is exactly what the old columns did. The
  // count going UP is the append-only guarantee.
  reclosed.body.events.length === 3
    ? ok('three events survive — the row count goes UP, it does not overwrite')
    : bad('three events', `${reclosed.body.events.length} events`)

  reclosed.body.events[0].note === 'First fix — tightened the bracket.'
    ? ok('the FIRST closure is still readable after a reopening and a second closure')
    : bad('first closure kept', reclosed.body.events[0]?.note)

  reclosed.body.events.map((e) => e.kind).join(',') === 'CLOSED,REOPENED,CLOSED'
    ? ok('the trail reads in order, oldest first')
    : bad('trail order', reclosed.body.events.map((e) => e.kind).join(','))

  reclosed.body.closure?.note === 'Replaced the bracket outright.'
    ? ok('the closure in force is the LATEST closure, not the first')
    : bad('latest closure', reclosed.body.closure?.note)

  const reopenOpen = await manager(`/maintenance/${vendored.id}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ note: 'x' }),
  })
  reopenOpen.status === 409
    ? ok('reopening a request that is already open is a 409')
    : bad('reopen open', reopenOpen.status)

  const reopenNoNote = await manager(`/maintenance/${toClose.id}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ note: '  ' }),
  })
  reopenNoNote.status === 400
    ? ok('reopening without a reason is refused — the reason IS the record')
    : bad('reopen blank note', reopenNoNote.status)

  // ── Append-only, two layers ──────────────────────────────────────────────
  console.log('\n\x1b[1mAppend-only, two layers asserted separately\x1b[0m')

  // 1. The APP ROLE is refused by PRIVILEGE — REVOKE UPDATE, DELETE means the
  //    running API fails before any trigger is reached.
  // 2. A SUPERUSER is refused by the TRIGGER — it ignores grants entirely, so
  //    this is the only proof against a direct psql session.
  const eventId = reclosed.body.events[0].id
  await runAsSystem(async () => {
    await rejects('the app role cannot UPDATE a trail event (privilege)', () =>
      prisma.maintenanceEvent.update({ where: { id: eventId }, data: { note: 'edited' } }),
    )
    await rejects('the app role cannot DELETE a trail event (privilege)', () =>
      prisma.maintenanceEvent.delete({ where: { id: eventId } }),
    )
  })
  await rejects('a SUPERUSER cannot UPDATE a trail event — the trigger holds', () =>
    owner.query(`UPDATE "maintenance_events" SET note = 'edited' WHERE id = $1`, [eventId]),
  )
  await rejects('a SUPERUSER cannot DELETE a trail event — the trigger holds', () =>
    owner.query(`DELETE FROM "maintenance_events" WHERE id = $1`, [eventId]),
  )

  // ── Roles ────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mWho may do what\x1b[0m')

  const filed = await tech('/maintenance', {
    method: 'POST',
    body: JSON.stringify({ apartmentId: seed.aptId, title: 'Latch on the back door', priority: 'LOW' }),
  })
  filed.status === 201 ? ok('a tech may file a request') : bad('tech files', filed.status)

  const raised = await tech(`/maintenance/${filed.body.id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority: 'URGENT' }),
  })
  raised.status === 200 && raised.body.priority === 'URGENT'
    ? ok('a tech may RAISE a priority — anyone who smells gas can shout')
    : bad('tech raises', raised.status)

  const lowered = await tech(`/maintenance/${filed.body.id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority: 'LOW' }),
  })
  lowered.status === 403
    ? ok('a tech may NOT lower one — quieting an alarm is a manager’s judgement')
    : bad('tech lowers', lowered.status)

  const mgrLowered = await manager(`/maintenance/${filed.body.id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority: 'LOW' }),
  })
  mgrLowered.status === 200 && mgrLowered.body.priority === 'LOW'
    ? ok('a manager may lower it')
    : bad('manager lowers', mgrLowered.status)

  const techClose = await tech(`/maintenance/${filed.body.id}/close`, {
    method: 'POST',
    body: JSON.stringify({ status: 'RESOLVED', note: 'done' }),
  })
  techClose.status === 403
    ? ok('a tech may not close — closing is the record that says work is done')
    : bad('tech closes', techClose.status)

  const techReopen = await tech(`/maintenance/${toClose.id}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ note: 'no' }),
  })
  techReopen.status === 403 ? ok('a tech may not reopen') : bad('tech reopens', techReopen.status)

  // ── Editing what a request says ──────────────────────────────────────────
  console.log('\n\x1b[1mEditing a request\x1b[0m')

  const editable = await aged('NORMAL', 3 * HOUR)

  const edited = await tech(`/maintenance/${editable.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Corrected title', description: 'Added later.' }),
  })
  edited.status === 200 && edited.body.title === 'Corrected title'
    ? ok('a tech may correct an open request — filing is all-staff, so is fixing it')
    : bad('tech edits', JSON.stringify(edited.body)?.slice(0, 120))

  const empty = await tech(`/maintenance/${editable.id}`, { method: 'PATCH', body: '{}' })
  empty.status === 400
    ? ok('an empty patch is a 400, not a cheerful 200')
    : bad('empty patch', empty.status)

  const noSuchApt = await tech(`/maintenance/${editable.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ apartmentId: 'nope' }),
  })
  noSuchApt.status === 404 ? ok('moving to a missing apartment is a 404') : bad('bad apt', noSuchApt.status)

  // Moving apartments, asserted as a PAIR. "It appears in the new place"
  // passes while the request is still counted in the old one, which is the
  // failure that would matter — an apartment's open count is what the
  // apartment list and the detail page both read.
  const otherApt = await runAsSystem(async () =>
    prisma.apartment.findFirst({ where: { id: { not: seed.aptId } } }),
  )
  await tech(`/maintenance/${editable.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ apartmentId: otherApt.id }),
  })
  const fromDetail = async (aptId) =>
    (await manager(`/apartments/${aptId}`)).body.maintenanceRequests.map((r) => r.id)
  const inNew = (await fromDetail(otherApt.id)).includes(editable.id)
  const goneFromOld = !(await fromDetail(seed.aptId)).includes(editable.id)
  inNew && goneFromOld
    ? ok('a moved request lands on the new apartment AND leaves the old one')
    : bad('apartment move', `in new: ${inNew}, gone from old: ${goneFromOld}`)

  // The freeze, in both directions — "it was refused" passes if the route is
  // simply broken, so the title is read back afterwards.
  const frozen = await aged('NORMAL', 3 * HOUR)
  await manager(`/maintenance/${frozen.id}/close`, {
    method: 'POST',
    body: JSON.stringify({ status: 'RESOLVED', note: 'Done.' }),
  })
  const afterClose = await tech(`/maintenance/${frozen.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'sneaky rename' }),
  })
  const stillNamed = await runAsSystem(async () =>
    prisma.maintenanceRequest.findUnique({ where: { id: frozen.id }, select: { title: true } }),
  )
  afterClose.status === 409 && stillNamed.title !== 'sneaky rename'
    ? ok('a CLOSED request refuses an edit (409) and its title is unchanged')
    : bad('closed freeze', `${afterClose.status}, title now ${stillNamed.title}`)

  // ── Ownership is reachable ───────────────────────────────────────────────
  console.log('\n\x1b[1mVendor and work order\x1b[0m')

  // The regression this whole item exists to prevent: these columns shipped
  // with nothing in the UI able to set them, so the only writer was the seed.
  const jobbed = await aged('NORMAL', 3 * HOUR)
  const assigned = await tech(`/maintenance/${jobbed.id}/start`, {
    method: 'POST',
    body: JSON.stringify({ vendorName: 'Ridgeway Glazing', workOrderRef: '118' }),
  })
  assigned.body.vendorName === 'Ridgeway Glazing' && assigned.body.workOrderRef === '118'
    ? ok('a vendor and a work order can be recorded through the API')
    : bad('vendor stored', JSON.stringify(assigned.body)?.slice(0, 120))

  const reassigned = await tech(`/maintenance/${jobbed.id}/start`, {
    method: 'POST',
    body: JSON.stringify({ vendorName: 'Kellerman Plumbing', workOrderRef: 'KP-9' }),
  })
  reassigned.body.vendorName === 'Kellerman Plumbing' && reassigned.body.workOrderRef === 'KP-9'
    ? ok('and changed again when the job moves to another vendor')
    : bad('vendor changed', JSON.stringify(reassigned.body)?.slice(0, 120))

  // ── Closed this month ────────────────────────────────────────────────────
  console.log('\n\x1b[1mThe closed-this-month figure\x1b[0m')

  const before = (await manager('/maintenance/house')).body.figures.closedThisMonth
  const thisMonth = await aged('NORMAL', 2 * HOUR)
  await manager(`/maintenance/${thisMonth.id}/close`, {
    method: 'POST',
    body: JSON.stringify({ status: 'RESOLVED', note: 'Closed just now.' }),
  })
  const after = (await manager('/maintenance/house')).body.figures.closedThisMonth
  after === before + 1
    ? ok('closing a request now moves closedThisMonth by exactly one')
    : bad('closedThisMonth rises', `${before} → ${after}`)

  // The seed's two closures are 64 and 12 days back, so on any day of any
  // month at least one of them is NOT this month — proving the figure is a
  // window rather than a count of everything closed.
  const closedTotal = await runAsSystem(async () =>
    prisma.maintenanceRequest.count({ where: { status: { in: ['RESOLVED', 'CANCELLED'] } } }),
  )
  after < closedTotal
    ? ok('and it is a WINDOW — older closures are not counted')
    : bad('closedThisMonth window', `${after} counted of ${closedTotal} closed`)

  // ── One order ────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mOne order, shared\x1b[0m')

  const all = (await manager('/maintenance')).body.requests
  const firstClosed = all.findIndex((r) => r.state === 'CLOSED')
  const lastOpen = all.map((r) => r.state !== 'CLOSED').lastIndexOf(true)
  firstClosed === -1 || firstClosed > lastOpen
    ? ok('open work sorts above closed work')
    : bad('open first', `a closed request at ${firstClosed} precedes open work at ${lastOpen}`)

  const detail = await manager(`/apartments/${seed.aptId}`)
  const listForApt = all.filter((r) => r.apartmentId === seed.aptId).map((r) => r.id)
  detail.body.maintenanceRequests.map((r) => r.id).join(',') === listForApt.join(',')
    ? ok('the apartment page and the list agree on order — REQUEST_ORDER is shared')
    : bad('shared order', 'the two reads returned different orders')

  // ── Audit ────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mAudit\x1b[0m')

  const audited = await runAsSystem(async () =>
    prisma.auditLog.count({ where: { entity: 'MaintenanceEvent' } }),
  )
  audited > 0
    ? ok(`trail writes are audited (${audited} rows)`)
    : bad('audited', audited)

  const leak = await runAsSystem(async () =>
    prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "audit_log"
       WHERE "entity" IN ('MaintenanceRequest','MaintenanceEvent')
         AND ("entityId" ILIKE '%bracket%' OR "entityId" ILIKE '%latch%' OR "entityId" ILIKE '%Ridgeway%')`),
  )
  leak[0].n === 0
    ? ok('audit rows carry ids only — no notes, no vendor names')
    : bad('no detail in audit', leak[0].n)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  await owner.end()
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => {
  console.error(e)
  process.exit(1)
})
