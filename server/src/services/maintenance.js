import { prisma, runInTransaction } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import {
  MAINTENANCE_CLOSED_STATUSES,
  MAINTENANCE_EVENT_KIND,
  MAINTENANCE_OPEN_STATUSES,
  MAINTENANCE_PRIORITY,
  MAINTENANCE_STATUS,
  MAINTENANCE_TARGET_MS,
  STAFF_ROLE,
} from '../domain/constants.js'

/**
 * A request's derived state. Frozen constant, deliberately NOT a schema enum —
 * the PRESENCE / SESSION_STATE / CHECK_STATE pattern. Nothing stores this: it
 * is `status` read against the clock, so changing a target re-reads every
 * request correctly instead of needing a backfill.
 */
export const MAINTENANCE_STATE = Object.freeze({
  OPEN: 'OPEN',
  OVERDUE: 'OVERDUE',
  CLOSED: 'CLOSED',
})

/// Priority as a number, so "raising" and "lowering" mean something. Ordered
/// the same way the Prisma enum is declared, which is what makes the
/// `priority: 'desc'` sort below put URGENT first.
const PRIORITY_RANK = Object.freeze({
  [MAINTENANCE_PRIORITY.LOW]: 0,
  [MAINTENANCE_PRIORITY.NORMAL]: 1,
  [MAINTENANCE_PRIORITY.URGENT]: 2,
})

const MANAGERS = [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER]

/**
 * ONE order, used by `listRequests` and by the apartment detail read.
 *
 * These were two different orders until 2026-08-07 — the list sorted by
 * priority and the apartment page by status — so the same collection read two
 * ways came back arranged two ways. Open work first (the enum is declared
 * OPEN, IN_PROGRESS, RESOLVED, CANCELLED, so `asc` IS open-first), then urgent
 * first, then oldest: the thing that has been broken longest and matters most
 * sits at the top.
 *
 * Note this cannot sort by derived state — OVERDUE is computed against the
 * clock and no database order can express it. Bands on the page do that work.
 */
export const REQUEST_ORDER = Object.freeze([
  { status: 'asc' },
  { priority: 'desc' },
  { reportedAt: 'asc' },
])

export const WITH_PEOPLE = Object.freeze({
  apartment: { select: { id: true, name: true, cohort: true } },
  reportedBy: { select: { id: true, fullName: true } },
  assignedTo: { select: { id: true, fullName: true } },
  events: {
    orderBy: { at: 'asc' },
    include: { actor: { select: { id: true, fullName: true } } },
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// Derivation — the one knob
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Urgent and still open, at any age. Kept alongside the target rule rather than
 * replaced by it: an urgent request filed twenty minutes ago is a hazard and
 * belongs in the bell before any clock has run.
 */
export function urgentOpenWhere() {
  return {
    priority: MAINTENANCE_PRIORITY.URGENT,
    status: { in: [...MAINTENANCE_OPEN_STATUSES] },
  }
}

/**
 * Open past its OWN target — urgent 24h, normal 7 days, low 30 days.
 *
 * THE one knob, the `overdueWhere()` idiom: the page, the bell and the
 * dashboard all derive through this, so the three cannot disagree about what
 * is late. One OR arm per priority, because each measures against a different
 * cutoff.
 */
export function overdueRequestWhere(now = new Date()) {
  return {
    status: { in: [...MAINTENANCE_OPEN_STATUSES] },
    OR: Object.entries(MAINTENANCE_TARGET_MS).map(([priority, target]) => ({
      priority,
      reportedAt: { lt: new Date(now.getTime() - target) },
    })),
  }
}

/**
 * What the bell and the dashboard surface: urgent-and-open, OR overdue against
 * its own target. A union rather than a replacement — see `urgentOpenWhere`.
 */
export function bellMaintenanceWhere(now = new Date()) {
  return { OR: [urgentOpenWhere(), overdueRequestWhere(now)] }
}

/** The instant a request crosses into OVERDUE. Null once it is closed. */
export function dueAt(request) {
  if (!MAINTENANCE_OPEN_STATUSES.includes(request.status)) return null
  const target = MAINTENANCE_TARGET_MS[request.priority]
  if (target === undefined) return null
  return new Date(new Date(request.reportedAt).getTime() + target)
}

/**
 * Pure, and the mirror of `overdueRequestWhere` — the admin app copies this
 * into utils/maintenance.js so a row and the band it sits in cannot disagree.
 * Keep the two in step.
 */
export function requestState(request, now = new Date()) {
  if (!MAINTENANCE_OPEN_STATUSES.includes(request.status)) return MAINTENANCE_STATE.CLOSED
  const due = dueAt(request)
  if (due && now.getTime() > due.getTime()) return MAINTENANCE_STATE.OVERDUE
  return MAINTENANCE_STATE.OPEN
}

// ─────────────────────────────────────────────────────────────────────────────
// Shaping
// ─────────────────────────────────────────────────────────────────────────────

function shapeEvent(e) {
  return {
    id: e.id,
    kind: e.kind,
    closedAs: e.closedAs,
    note: e.note,
    at: e.at,
    actor: e.actor ?? null,
  }
}

/**
 * Lives here rather than in services/apartments.js, which is where it was until
 * 2026-08-07 — maintenance imported it back out of apartments, so the two
 * modules pointed at each other for the shape of a thing only one of them owns.
 */
export function shapeRequest(r, now = new Date()) {
  const events = (r.events ?? []).map(shapeEvent)
  const closed = MAINTENANCE_CLOSED_STATUSES.includes(r.status)

  return {
    id: r.id,
    apartmentId: r.apartmentId,
    apartmentName: r.apartment?.name ?? undefined,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    state: requestState(r, now),
    dueAt: dueAt(r),

    reportedBy: r.reportedBy ?? null,
    reportedAt: r.reportedAt,

    assignedTo: r.assignedTo ?? null,
    vendorName: r.vendorName ?? null,
    workOrderRef: r.workOrderRef ?? null,

    /// The whole trail, oldest first. Small by construction — a request is
    /// closed once, twice if somebody reopened it.
    events,
    /// The closure in force right now, or null while the request is open. A
    /// read over the trail, never a stored column: that is the point of having
    /// dropped resolvedBy/resolvedAt/resolutionNote.
    closure: closed
      ? (events.filter((e) => e.kind === MAINTENANCE_EVENT_KIND.CLOSED).at(-1) ?? null)
      : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listRequests({ status, apartmentId, priority } = {}) {
  const where = {}
  if (apartmentId) where.apartmentId = apartmentId
  if (priority) where.priority = priority
  if (status === 'open') {
    where.status = { in: [...MAINTENANCE_OPEN_STATUSES] }
  } else if (status) {
    where.status = status
  }

  const rows = await prisma.maintenanceRequest.findMany({
    where,
    include: WITH_PEOPLE,
    orderBy: [...REQUEST_ORDER],
  })
  const now = new Date()
  return rows.map((r) => shapeRequest(r, now))
}

/**
 * The page's one composed read, the `/census` and `/service` pattern: figures
 * and rows from a single call, so two halves of a screen cannot disagree
 * because one loaded a second later.
 */
export async function houseMaintenance() {
  const now = new Date()
  const requests = await listRequests()

  const open = requests.filter((r) => r.state !== MAINTENANCE_STATE.CLOSED)
  const overdue = open.filter((r) => r.state === MAINTENANCE_STATE.OVERDUE)

  return {
    requests,
    figures: {
      open: open.length,
      overdue: overdue.length,
      urgent: open.filter((r) => r.priority === MAINTENANCE_PRIORITY.URGENT).length,
      inProgress: open.filter((r) => r.status === MAINTENANCE_STATUS.IN_PROGRESS).length,
    },
    /// Echoed so a screen cannot quote a target the server disagrees with —
    /// the `feeCents` habit from module 5.
    targetMs: MAINTENANCE_TARGET_MS,
    at: now,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

async function loadRequest(id) {
  const existing = await prisma.maintenanceRequest.findUnique({ where: { id } })
  if (!existing) throw new HttpError(404, 'Request not found')
  return existing
}

function reread(id) {
  return prisma.maintenanceRequest
    .findUnique({ where: { id }, include: WITH_PEOPLE })
    .then((r) => shapeRequest(r))
}

export async function createRequest({ apartmentId, title, description, priority }, actorId) {
  const apartment = await prisma.apartment.findUnique({ where: { id: apartmentId } })
  if (!apartment) throw new HttpError(404, 'Apartment not found')

  const created = await prisma.maintenanceRequest.create({
    data: { apartmentId, title, description, priority, reportedById: actorId },
    include: WITH_PEOPLE,
  })
  return shapeRequest(created)
}

/**
 * Take the job, or hand it to somebody — in-house, a vendor, or both.
 *
 * All-staff, and it DEFAULTS THE ASSIGNEE TO THE ACTOR when nobody is named
 * and no vendor is given. A tech in a hallway taps "I'm on it" once and the
 * state is true; making them fill in a name first is how IN_PROGRESS goes back
 * to being a word nobody sets. The database refuses the ownerless case
 * regardless (`maintenance_in_progress_needs_owner`).
 */
export async function startWork(id, { assignedToId, vendorName, workOrderRef } = {}, actorId) {
  const existing = await loadRequest(id)
  if (MAINTENANCE_CLOSED_STATUSES.includes(existing.status)) {
    throw new HttpError(409, 'That request is closed. Reopen it before starting work.')
  }

  const named = assignedToId ?? null
  const vendor = vendorName?.trim() || null
  // Nobody named and no vendor: the actor is taking it.
  const assignee = named ?? (vendor ? null : actorId)

  if (assignee) {
    const user = await prisma.user.findUnique({ where: { id: assignee } })
    if (!user || user.role === STAFF_ROLE.RESIDENT) {
      throw new HttpError(400, 'Assign a request to a staff member.')
    }
  }

  await prisma.maintenanceRequest.update({
    where: { id },
    data: {
      status: MAINTENANCE_STATUS.IN_PROGRESS,
      assignedToId: assignee,
      vendorName: vendor,
      workOrderRef: workOrderRef?.trim() || null,
    },
  })
  return reread(id)
}

/**
 * Close it — RESOLVED or CANCELLED — and append the closure.
 *
 * Two rows in one `runInTransaction`: a status with no trail row is a request
 * that closed itself, and the trail is the only place the note lives now.
 */
export async function closeRequest(id, { status, note }, actorId) {
  if (!MAINTENANCE_CLOSED_STATUSES.includes(status)) {
    throw new HttpError(400, 'Close a request as RESOLVED or CANCELLED.')
  }
  if (!note?.trim()) {
    // The database refuses this too. Saying so here names the field.
    throw new HttpError(400, 'Closing a request requires a note saying what was done.')
  }

  const existing = await loadRequest(id)
  if (MAINTENANCE_CLOSED_STATUSES.includes(existing.status)) {
    throw new HttpError(409, 'That request is already closed.')
  }

  // The callback takes NO transaction client: `runInTransaction` puts the
  // transaction in AsyncLocalStorage and the extended `prisma` picks it up.
  // Writing through a bare `tx` here would commit the rows while skipping the
  // audit and soft-delete extensions — the failure db/client.js exists to
  // prevent.
  await runInTransaction(async () => {
    await prisma.maintenanceRequest.update({ where: { id }, data: { status } })
    await prisma.maintenanceEvent.create({
      data: {
        requestId: id,
        kind: MAINTENANCE_EVENT_KIND.CLOSED,
        closedAs: status,
        note: note.trim(),
        actorId,
      },
    })
  })
  return reread(id)
}

/**
 * Reopen it. Appends a REOPENED row and leaves every earlier closure standing —
 * which is the entire reason the trail exists. Until 2026-08-07 this cleared
 * `resolvedBy`, `resolvedAt` and `resolutionNote`, so the first closure of a
 * request closed twice was simply gone.
 *
 * Ownership is deliberately NOT cleared: the last people to touch the job are
 * exactly who you want to know about when the work did not hold. The request
 * returns to OPEN rather than IN_PROGRESS, because nobody is working on it at
 * the moment it is reopened.
 */
export async function reopenRequest(id, { note }, actorId) {
  if (!note?.trim()) {
    throw new HttpError(400, 'Reopening a request requires a note saying why.')
  }

  const existing = await loadRequest(id)
  if (!MAINTENANCE_CLOSED_STATUSES.includes(existing.status)) {
    throw new HttpError(409, 'That request is already open.')
  }

  await runInTransaction(async () => {
    await prisma.maintenanceRequest.update({
      where: { id },
      data: { status: MAINTENANCE_STATUS.OPEN },
    })
    await prisma.maintenanceEvent.create({
      data: {
        requestId: id,
        kind: MAINTENANCE_EVENT_KIND.REOPENED,
        note: note.trim(),
        actorId,
      },
    })
  })
  return reread(id)
}

/**
 * Change the priority, which is now the thing that decides when a request is
 * late.
 *
 * RAISING IS ALL-STAFF, LOWERING IS MANAGERS. Anyone who smells gas can make a
 * request urgent — making them find a manager first is how it ends up
 * unrecorded, the sign-out and roll-taking reasoning. Quieting an alarm is a
 * judgement about the facility's own risk, so it sits where the other
 * judgements do.
 *
 * The rule cannot be expressed as `requireRole` middleware, because whether it
 * applies depends on the body, so it lives here with its reasoning rather than
 * being split across a route.
 *
 * No trail row: the facility asked for a trail of closing and reopening, and
 * the audit extension already records who changed what.
 */
export async function setPriority(id, priority, { actorRole }) {
  const existing = await loadRequest(id)
  if (MAINTENANCE_CLOSED_STATUSES.includes(existing.status)) {
    throw new HttpError(409, 'That request is closed. Reopen it before changing its priority.')
  }

  const lowering = PRIORITY_RANK[priority] < PRIORITY_RANK[existing.priority]
  if (lowering && !MANAGERS.includes(actorRole)) {
    throw new HttpError(403, 'Only a manager can lower a request’s priority.')
  }

  await prisma.maintenanceRequest.update({ where: { id }, data: { priority } })
  return reread(id)
}
