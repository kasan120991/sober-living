import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { getRequestContext } from '../lib/requestContext.js'
import { AUDIT_ACTION, AUDITED_MODELS, SOFT_DELETE_MODELS } from '../domain/constants.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { getDbActor } from '../lib/dbContext.js'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
}

/**
 * The RUNTIME connection, which must not be the owner or a superuser — both
 * bypass row-level security, the second of which does so even with FORCE. Set
 * up by `npm run db:app-role`.
 *
 * DATABASE_URL stays the owner connection and is used by `prisma migrate`.
 */
const runtimeUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL
if (!process.env.APP_DATABASE_URL) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_DATABASE_URL is not set. The application must not connect as the ' +
        'database owner in production — row-level security would be bypassed.',
    )
  }
  console.warn(
    '[db] APP_DATABASE_URL not set — connecting as the owner, so row-level ' +
      'security is NOT in effect. Run `npm run db:app-role`.',
  )
}

const adapter = new PrismaPg({ connectionString: runtimeUrl })

/**
 * The BASE client. Deliberately not exported.
 *
 * Query logging prints parameter values, which for this app means resident
 * names and screen results in stdout. Errors only, in every environment.
 */
const base = new PrismaClient({ adapter, log: ['error'] })

const softDeletable = new Set(SOFT_DELETE_MODELS)
const audited = new Set(AUDITED_MODELS)

const READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
])

const ACTION_BY_OP = {
  create: AUDIT_ACTION.CREATE,
  createMany: AUDIT_ACTION.CREATE,
  createManyAndReturn: AUDIT_ACTION.CREATE,
  update: AUDIT_ACTION.UPDATE,
  updateMany: AUDIT_ACTION.UPDATE,
  upsert: AUDIT_ACTION.UPDATE,
  delete: AUDIT_ACTION.SOFT_DELETE,
  deleteMany: AUDIT_ACTION.SOFT_DELETE,
}

/** Pull record ids out of a result without touching any other field. */
function idsFrom(result) {
  if (!result) return []
  if (Array.isArray(result)) return result.map((r) => r?.id).filter(Boolean)
  return result.id ? [result.id] : []
}

/**
 * Audit rows are written with the BASE client on purpose. Writing them through
 * the extended client would re-enter the audit extension and recurse forever.
 *
 * IDs only. Never names, screen results, or med details — this table is read by
 * people who are not authorized to see the underlying records.
 */
async function writeAuditEntries({ model, action, ids, subjectResidentId }) {
  const ctx = getRequestContext()
  const rows = (ids.length ? ids : [null]).map((entityId) => ({
    actorId: ctx.actorId,
    actorRole: ctx.actorRole,
    action,
    entity: model,
    entityId,
    subjectResidentId: subjectResidentId ?? null,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  }))

  try {
    await base.auditLog.createMany({ data: rows })
  } catch (err) {
    // An audit write must never silently vanish. If it cannot be recorded, that
    // is a compliance incident, so make noise — but do not take down the
    // request that already succeeded.
    console.error('AUDIT WRITE FAILED', {
      model,
      action,
      requestId: ctx.requestId,
      message: err.message,
    })
  }
}

/** Tables carrying row-level security policies — see the RLS migration. */
const RLS_MODELS = new Set([
  'Resident',
  'Stay',
  'EmergencyContact',
  'Document',
  'BedAssignment',
  'ScheduleAttendee',
  'ScheduleAttendance',
  'ServiceEntry',
  'ApartmentCheck',
  'ApartmentCheckResident',
  'DrugScreen',
  'Medication',
  'MedLog',
  'TravelPass',
  // Staff read all; a resident reads only events addressed to them by name.
  'Notification',
  'Invoice',
  'InvoiceLine',
  'StripeEvent',
])

/**
 * Runs `cb` against a client that the RLS policies will accept.
 *
 * Policies read `app.actor_kind` / `app.resident_id`, which are per-session
 * settings. Connections are pooled, so they must be scoped with
 * `set_config(..., local => true)` inside a transaction — a plain SET would
 * leak one request's identity onto whatever request got that connection next.
 *
 * Cost: one short transaction per operation on an RLS table. Fine at this
 * app's scale; if it ever isn't, the fix is a request-scoped transaction, not
 * dropping the context.
 *
 * Everything that touches an RLS table goes through here — including the
 * soft-delete extension's internal writes, which would otherwise run on the
 * bare client and be refused by a fail-closed policy.
 */
/**
 * The transaction currently in scope, if any. Set by runInTransaction so that
 * withRlsClient reuses it instead of opening a nested one — Prisma cannot nest
 * interactive transactions, and re-entering would also discard the actor
 * context already established on the outer one.
 */
const txStorage = new AsyncLocalStorage()

/**
 * Runs a multi-step unit of work atomically, with the actor context set once.
 *
 * Intake is the motivating case: a Resident, a Stay and a BedAssignment must
 * all exist or none of them. Without this each operation would commit
 * separately and a failure halfway would leave a resident with no stay.
 */
export function runInTransaction(cb) {
  // REENTRANT: already inside a unit of work, so reuse it. Prisma cannot nest
  // interactive transactions, and the actor context is already set on the open
  // one — this is withRlsClient's own rule ("already inside a unit of work —
  // reuse its transaction and its context") applied one level up.
  //
  // It matters as soon as services compose: postEntry() wraps its write plus a
  // notification, and removePendingCharge() calls postEntry from inside its own
  // transaction. Without this, the inner call asks Postgres for a transaction
  // inside a transaction and the removal fails.
  if (txStorage.getStore()) return Promise.resolve().then(cb)

  const actor = getDbActor()
  if (!actor) {
    return Promise.reject(
      new Error('runInTransaction needs a database actor context (runAsSystem or a request).'),
    )
  }
  return base.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.actor_kind', ${actor.kind}, true),
                                set_config('app.resident_id', ${actor.residentId ?? ''}, true)`
    return txStorage.run(tx, () => cb())
  })
}

function withRlsClient(model, cb) {
  // Already inside a unit of work — reuse its transaction and its context.
  const open = txStorage.getStore()
  if (open) return cb(open)

  const actor = getDbActor()

  if (!actor) {
    if (RLS_MODELS.has(model)) {
      // Fail closed AND loudly. Without this the policies would quietly return
      // zero rows and the caller would conclude the table was empty.
      return Promise.reject(
        new Error(
          `${model} was queried with no database actor context. Wrap it in ` +
            'runAsSystem() (scripts) or ensure dbActorMiddleware ran (requests).',
        ),
      )
    }
    // Legitimately contextless: sign-in reads `users` before a session exists.
    return cb(base)
  }

  return base.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.actor_kind', ${actor.kind}, true),
                                set_config('app.resident_id', ${actor.residentId ?? ''}, true)`
    return cb(tx)
  })
}

// ORDER MATTERS. Prisma applies the FIRST-declared extension as the OUTERMOST
// query hook, so these run audit → soft delete → RLS → database.
//
// RLS must be LAST (innermost) because it re-issues the operation on a bare
// transaction client to attach the actor context. Declared first, it would run
// outermost and that re-issued call would bypass every extension beneath it —
// which silently turned soft deletes on resident data into HARD deletes and
// dropped their audit rows.
export const prisma = base
  // ── Audit ──────────────────────────────────────────────────────────────────
  // Every read and write of resident data, recorded by construction.
  .$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args)
          if (!audited.has(model)) return result

          const action = READ_OPS.has(operation)
            ? AUDIT_ACTION.READ
            : ACTION_BY_OP[operation]
          if (!action) return result

          await writeAuditEntries({
            model,
            action,
            ids: idsFrom(result),
            subjectResidentId:
              model === 'Resident' ? idsFrom(result)[0] ?? null : args?.where?.residentId ?? null,
          })
          return result
        },
      },
    },
  })

  // ── Soft delete ────────────────────────────────────────────────────────────
  // Destroyed records stop being reachable without every caller remembering a
  // `deletedAt: null` clause. Records are retained, never destroyed.
  .$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!softDeletable.has(model)) return query(args)

          // findUnique/findUniqueOrThrow only accept unique fields in `where`,
          // so the filter cannot go in the query — check the result instead.
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const result = await query(args)
            return result?.deletedAt ? null : result
          }

          if (
            operation === 'findMany' ||
            operation === 'findFirst' ||
            operation === 'findFirstOrThrow' ||
            operation === 'count' ||
            operation === 'aggregate' ||
            operation === 'groupBy'
          ) {
            // Default-closed, deliberately open: the filter is added only when
            // the query says nothing about deletedAt. Forgetting still means
            // filtered; reaching removed rows takes an explicit clause — which
            // is what restore does (services/apartments.js), on purpose,
            // through this client, so the read is still audited and RLS'd.
            if (args.where?.deletedAt === undefined) {
              args.where = { ...args.where, deletedAt: null }
            }
            return query(args)
          }

          // Turn destructive deletes into soft deletes. `query` is deliberately
          // NOT called here — calling it would issue the real DELETE.
          if (operation === 'delete') {
            return withRlsClient(model, (c) =>
              c[lowerFirst(model)].update({
                where: args.where,
                data: { deletedAt: new Date() },
              }),
            )
          }
          if (operation === 'deleteMany') {
            return withRlsClient(model, (c) =>
              c[lowerFirst(model)].updateMany({
                where: { ...args.where, deletedAt: null },
                data: { deletedAt: new Date() },
              }),
            )
          }

          return query(args)
        },
      },
    },
  })
  // ── Row-level security context ─────────────────────────────────────────────
  .$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Applies to every model, not only RLS-protected roots: a query on
          // Apartment that includes beds → assignments reaches bed_assignments,
          // which is policy-protected. Scoping this to RLS roots left nested
          // includes contextless, and they silently returned nothing.
          return withRlsClient(model, (c) => c[lowerFirst(model)][operation](args))
        },
      },
    },
  })

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

export async function disconnect() {
  await base.$disconnect()
}
