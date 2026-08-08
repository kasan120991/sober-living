import { prisma } from '../db/client.js'
import { NOTIFICATION_CLASS, NOTIFICATION_KIND, STAFF_ROLE } from '../domain/constants.js'

/**
 * Recording that something happened.
 *
 * A LEAF MODULE, and that is forced rather than tidy. services/notifications.js
 * already imports checks.js, passes.js, maintenance.js, meds.js and
 * signOuts.js — which is where most of the call sites below live — so putting
 * notify() there would be a real ESM cycle. This file imports the client and
 * the constants and nothing else, and it must stay that way.
 *
 * THE SOCKET IS NOT INVOLVED. Writing a row here changes nothing about how
 * realtime works: the domain write's own `res.on('finish')` broadcasts the same
 * `{ at }` it has always broadcast, every client refetches GET /notifications
 * over authenticated HTTP, and the role filter is a `where` clause evaluated
 * once per requesting session. A tech's socket and a manager's socket receive
 * byte-identical payloads; their two HTTP responses differ. That is what keeps
 * module 12's fan-out warning answered — the authorization is per-request, not
 * per-subscriber, because the fan-out still carries nothing.
 */

const { ADMIN, HOUSE_MANAGER, STAFF } = STAFF_ROLE
const MANAGERS = [ADMIN, HOUSE_MANAGER]
const ALL_STAFF = [ADMIN, HOUSE_MANAGER, STAFF]

/**
 * kind → { class, roles, to }. THE one knob.
 *
 * The call site supplies the sentence and the ids; the KIND supplies everything
 * else. That split is module 5's rule in its own words — "a service may post to
 * the ledger when every term of the entry is determined by the domain event;
 * anything a human chooses goes through the route." Nothing here is a human
 * choice: a tech filing a repair does not decide that managers get told, and
 * routing chosen at six call sites is six places for it to drift.
 *
 * `to` AGREES WITH `roles` BY CONSTRUCTION, which is the point of putting them
 * in one row rather than two tables. A MONEY event routes to managers and
 * points at /billing, whose route guard bounces a tech — so an event can never
 * send somebody to a screen they cannot open. That was a real defect on the
 * bell's URGENT_MAINTENANCE item, which used to link to the manager-only
 * apartment page.
 */
const ROUTE = Object.freeze({
  // ── Requests needing a decision ───────────────────────────────────────────
  // Filed by whoever is at the door, decided by a manager: two different
  // people, which is exactly what makes it news rather than an echo.
  [NOTIFICATION_KIND.PASS_REQUESTED]: {
    class: NOTIFICATION_CLASS.REQUEST,
    roles: MANAGERS,
    to: '/passes',
  },
  // ALL-STAFF, unlike its neighbours: filing a repair is a hallway act and so
  // is fixing one — the tech who hears the alarm may be the one with the
  // ladder. Module 10's own line.
  [NOTIFICATION_KIND.MAINTENANCE_FILED]: {
    class: NOTIFICATION_CLASS.REQUEST,
    roles: ALL_STAFF,
    to: '/maintenance',
  },
  // Verifying is all-staff, but a slip that has sat a fortnight is a manager's
  // problem, and /service leads with the verification queue.
  [NOTIFICATION_KIND.SERVICE_HOURS_LOGGED]: {
    class: NOTIFICATION_CLASS.REQUEST,
    roles: MANAGERS,
    to: '/service',
  },

  // ── Money ────────────────────────────────────────────────────────────────
  // Managers and admins only — module 12 decided this before it was built:
  // "a tech does not need to know a payment landed". /billing refuses a tech
  // anyway, which is the `to`-agrees-with-`roles` property doing its job.
  [NOTIFICATION_KIND.PAYMENT_RECEIVED]: {
    class: NOTIFICATION_CLASS.MONEY,
    roles: MANAGERS,
    to: '/billing',
  },
  [NOTIFICATION_KIND.INVOICE_SENT]: {
    class: NOTIFICATION_CLASS.MONEY,
    roles: MANAGERS,
    to: '/billing',
  },

  // ── Safety ───────────────────────────────────────────────────────────────
  // ALL-STAFF and the loudest thing here: a resident nobody can find. Whoever
  // is in the building is who can go and look.
  [NOTIFICATION_KIND.NOT_FOUND_ON_ROUND]: {
    class: NOTIFICATION_CLASS.SAFETY,
    roles: ALL_STAFF,
    to: '/checks',
  },
})

/**
 * Record that something happened.
 *
 * MUST BE CALLED INSIDE runInTransaction() WITH THE DOMAIN WRITE. A
 * notification that outlives a rolled-back act is a phantom — the app would
 * announce a travel pass that does not exist, on a screen it is not on, and no
 * amount of refetching would clear it because the feed is not derived.
 * verify-notifications.js asserts a failed POST leaves zero rows.
 *
 * WHAT MAY BE IN `title` AND `detail` IS A MODULE 13 QUESTION. The rule, and
 * it is testable: a fixed template plus a NAME, a COUNT, a TIME or a MONEY
 * AMOUNT. Free text a human typed crosses only when it is about a UNIT and
 * never about a PERSON — a maintenance title is about a unit and is already on
 * the bell; a pass purpose, a service note, a supervisor's name, a ledger
 * description, a check note and a sign-out destination are about a person and
 * never cross. Nothing clinical, ever: no kind here comes from module 5 or 6.
 *
 * @param {string} kind             a NOTIFICATION_KIND
 * @param {object} event
 * @param {string} event.title      the sentence — see the disclosure rule above
 * @param {string} [event.detail]   a second line, same rule
 * @param {string} [event.actorId]  who did it; null when nobody did (Stripe)
 * @param {string} [event.residentId] addressed to one resident BY NAME — the
 *   portal's half, unreachable today and null on every staff event
 * @param {string} [event.entity]   the model this is about, ids only
 * @param {string} [event.entityId]
 */
export function notify(
  kind,
  { title, detail = null, actorId = null, residentId = null, entity = null, entityId = null },
) {
  const route = ROUTE[kind]
  // A kind with no route reaches nobody, and the CHECK constraint would refuse
  // the row anyway. Failing here says why.
  if (!route) throw new Error(`No notification route for kind ${kind}`)

  return prisma.notification.create({
    data: {
      kind,
      class: route.class,
      roles: route.roles,
      to: route.to,
      title,
      detail,
      actorId,
      residentId,
      entity,
      entityId,
    },
  })
}
