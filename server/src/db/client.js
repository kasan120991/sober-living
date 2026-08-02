import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { getRequestContext } from '../lib/requestContext.js'
import { AUDIT_ACTION, AUDITED_MODELS, SOFT_DELETE_MODELS } from '../domain/constants.js'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

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

export const prisma = base
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
            args.where = { ...args.where, deletedAt: null }
            return query(args)
          }

          // Turn destructive deletes into soft deletes. `query` is deliberately
          // NOT called here — calling it would issue the real DELETE.
          if (operation === 'delete') {
            return base[lowerFirst(model)].update({
              where: args.where,
              data: { deletedAt: new Date() },
            })
          }
          if (operation === 'deleteMany') {
            return base[lowerFirst(model)].updateMany({
              where: { ...args.where, deletedAt: null },
              data: { deletedAt: new Date() },
            })
          }

          return query(args)
        },
      },
    },
  })
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

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

export async function disconnect() {
  await base.$disconnect()
}
