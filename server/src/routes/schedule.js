import { Router } from 'express'
import { z } from 'zod'

import { handler, parseBody } from '../lib/http.js'
import { requireAuth, requireStaff, requireRole } from '../middleware/authorize.js'
import { ATTENDANCE_STATUS, RECURRENCE, STAFF_ROLE } from '../domain/constants.js'
import { parseCohorts, residentSchedule, scheduleWindow } from '../services/schedule/read.js'
import {
  createEvent,
  deleteEvent,
  getEvent,
  moveSeries,
  rescheduleSession,
  sessionRoll,
  takeAttendance,
  updateEvent,
} from '../services/schedule/write.js'
import { listActiveResidentsByCohorts } from '../services/residents.js'

const router = Router()

router.use(requireAuth, requireStaff)

// Setting the schedule is a manager's job — CLAUDE.md's role table puts
// scheduling with the house manager, and a tech's job is executing it.
//
// TAKING THE ROLL IS NOT. That is all-staff, deliberately, for exactly the
// reason sign-outs are: the person running the group is standing in the room
// with the phone, and making them find a manager is how attendance ends up on
// a sheet of paper that never gets entered.
const managers = requireRole(STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER)

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM')

// ONE set of timing fields and ONE roster, whoever attends. The per-cohort
// occurrence rows are created by the service — see services/schedule/write.js.
// "Everyone" is two cohorts asked for explicitly, never a nullable cohort.
//
// KEPT AS A BARE OBJECT, with the refinements applied below rather than inline.
// `.refine()` returns a ZodEffects, which has no `.partial()` — so a patch schema
// is impossible to derive from a refined shape, and the only way to get one is to
// hold on to the object first.
// 0=Sunday..6=Saturday. Required for WEEKLY, refused for ONCE.
const weekdayList = z.array(z.number().int().min(0).max(6)).max(7)
const stayIdList = z.array(z.string().min(1))

// NO `.default()` on any field here, and that is load-bearing rather than tidy:
// `.partial()` makes a field optional but does NOT strip its default, so a shape
// carrying `weekdays: [].default([])` would have a PATCH of only `{title}` parse
// to `{title, weekdays: []}` — and updateEvent, which decides what changed by
// what is present, would read that as "clear the weekdays" and refuse the whole
// edit as a frozen shape change. Defaults belong on the create body alone, where
// absent really does mean empty.
const eventShape = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).optional().nullable(),
  location: z.string().trim().max(140).optional().nullable(),
  cohorts: z.array(z.enum(['MEN', 'WOMEN'])).min(1).max(2),
  startsAtLocal: timeStr,
  durationMinutes: z.number().int().min(1).max(1440),
  recurrence: z.enum([RECURRENCE.ONCE, RECURRENCE.WEEKLY]),
  weekdays: weekdayList,
  startsOn: dateStr,
  endsOn: dateStr.nullable().optional(),
  stayIds: stayIdList,
})

const createBody = eventShape
  .extend({ weekdays: weekdayList.default([]), stayIds: stayIdList.default([]) })
  .refine((o) => o.recurrence !== RECURRENCE.WEEKLY || o.weekdays.length > 0, {
    message: 'weekdays',
  })
  .refine((o) => o.recurrence !== RECURRENCE.ONCE || o.weekdays.length === 0, {
    message: 'weekdays',
  })
  .refine((o) => !o.endsOn || o.endsOn >= o.startsOn, { message: 'endsOn' })

// Every field optional, and the refinements rewritten to tolerate absence: a
// patch that sends only a title must not trip a rule about weekdays it never
// mentioned. Cross-field rules that need the STORED value — endsOn against the
// recorded history, weekdays against the stored recurrence — belong in
// updateEvent, which is the only place that can see both halves.
const patchBody = eventShape
  .partial()
  .refine((o) => o.recurrence !== RECURRENCE.WEEKLY || (o.weekdays?.length ?? 0) > 0, {
    message: 'weekdays',
  })
  .refine((o) => o.recurrence !== RECURRENCE.ONCE || (o.weekdays?.length ?? 0) === 0, {
    message: 'weekdays',
  })
  .refine((o) => !o.endsOn || !o.startsOn || o.endsOn >= o.startsOn, { message: 'endsOn' })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to change' })

// Moving a series. `from` is the first date of the NEW series; everything else is
// the shape it takes, defaulting to the old one's where absent — so "same group,
// Thursdays now" sends two fields.
const moveBody = eventShape
  .partial()
  .omit({ stayIds: true })
  .extend({
    from: dateStr,
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .refine((o) => o.recurrence !== RECURRENCE.ONCE || (o.weekdays?.length ?? 0) === 0, {
    message: 'weekdays',
  })
  .refine((o) => !o.endsOn || o.endsOn >= o.from, { message: 'endsOn' })

const attendanceBody = z.object({
  eventId: z.string().min(1),
  date: dateStr,
  marks: z
    .array(
      z.object({
        stayId: z.string().min(1),
        status: z.enum([
          ATTENDANCE_STATUS.ATTENDED,
          ATTENDANCE_STATUS.ABSENT,
          ATTENDANCE_STATUS.EXCUSED,
        ]),
        note: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1),
})

/** The board. Both lanes, always — see services/schedule/read.js. */
router.get(
  '/',
  handler(async (req, res) => {
    res.json(await scheduleWindow({ date: req.query.date, days: req.query.days }))
  }),
)

// Query param, so it must precede any '/:id' route below. `?cohort=MEN,WOMEN`
// serves the combined picker a both-cohorts event needs.
router.get(
  '/candidates',
  managers,
  handler(async (req, res) => {
    const cohorts = parseCohorts(req.query.cohort)
    res.json({ residents: await listActiveResidentsByCohorts(cohorts) })
  }),
)

/**
 * One session's roll. Addressed by (eventId, date), not by an id: a future
 * session has no row until something is recorded against it, and a both-cohorts
 * event has one roll across two occurrences.
 */
router.get(
  '/roll',
  handler(async (req, res) => {
    const { eventId, date } = parseBody(
      z.object({ eventId: z.string().min(1), date: dateStr }),
      req.query,
    )
    res.json(await sessionRoll(eventId, date))
  }),
)

// Setting the schedule is a manager's job; recording what happened at it is
// not. A reschedule is a DECISION, and its closest analogue — per-date cancel —
// is manager-only for the same reason: a moved session is a claim about what
// was scheduled, where a roll is an observation by whoever was in the room.
const rescheduleBody = z.object({
  eventId: z.string().min(1),
  date: dateStr,
  // Null puts the date back on the series rule — a mis-drag needs a way back.
  startsAtLocal: timeStr.nullable(),
})

router.post(
  '/reschedule',
  managers,
  handler(async (req, res) => {
    const data = parseBody(rescheduleBody, req.body)
    res.json(await rescheduleSession(data, req.session.userId))
  }),
)

router.post(
  '/attendance',
  handler(async (req, res) => {
    const data = parseBody(attendanceBody, req.body)
    res.json(await takeAttendance(data, req.session.userId))
  }),
)

router.post(
  '/events',
  managers,
  handler(async (req, res) => {
    const data = parseBody(createBody, req.body)
    res.status(201).json(await createEvent(data, req.session.userId))
  }),
)

router.get(
  '/events/:id',
  handler(async (req, res) => res.json(await getEvent(req.params.id))),
)

// Editing what an event IS, which is a manager's job for the same reason creating
// one is. Which fields are actually accepted depends on what has been recorded
// against it — see updateEvent. Identity and the roster are always live; when it
// runs freezes the moment anything is on the record.
router.patch(
  '/events/:id',
  managers,
  handler(async (req, res) => {
    const data = parseBody(patchBody, req.body)
    res.json(await updateEvent(req.params.id, data, req.session.userId))
  }),
)

// Moving a series is not an edit — it ends this one and starts its successor, so
// the dates already accounted for keep the rule that produced them. POST rather
// than PATCH because it creates a resource.
router.post(
  '/events/:id/move',
  managers,
  handler(async (req, res) => {
    const data = parseBody(moveBody, req.body)
    res.status(201).json(await moveSeries(req.params.id, data, req.session.userId))
  }),
)

router.delete(
  '/events/:id',
  managers,
  handler(async (req, res) => {
    await deleteEvent(req.params.id)
    res.status(204).end()
  }),
)

export default router

/** Mounted separately under /residents/:id/schedule — see routes/residents.js. */
export { residentSchedule }
