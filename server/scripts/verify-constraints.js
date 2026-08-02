/**
 * Proves the database-level invariants actually hold.
 *
 * These are the guarantees the domain depends on — cohort separation, no
 * double-booked beds, immutable audit and bed history. They are enforced by
 * Postgres, so they are verified against Postgres, not asserted in a comment.
 *
 * Run against a DISPOSABLE database:  node scripts/verify-constraints.js
 */
import './lib/as-owner.js'
import { prisma } from '../src/db/client.js'
import { runAsSystem } from '../src/lib/dbContext.js'
import { runWithRequestContext } from '../src/lib/requestContext.js'

let pass = 0
let fail = 0

function ok(name) {
  console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  pass++
}
function bad(name, detail) {
  console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${detail}`)
  fail++
}

/** Asserts the operation is REJECTED by the database. */
async function mustReject(name, fn) {
  try {
    await fn()
    bad(name, 'operation SUCCEEDED but should have been rejected')
  } catch (err) {
    ok(`${name}\n      rejected: ${String(err.message).split('\n').find((l) => l.trim()) ?? ''}`)
  }
}

async function mustAllow(name, fn) {
  try {
    const r = await fn()
    ok(name)
    return r
  } catch (err) {
    bad(name, `should have succeeded: ${err.message}`)
    return null
  }
}

async function main() {
  console.log('\nResetting test data…')
  await prisma.$executeRawUnsafe(`
    TRUNCATE "bed_assignments","stays","documents","emergency_contacts",
             "beds","apartments","residents","users","programs"
    RESTART IDENTITY CASCADE`)
  await prisma.$executeRawUnsafe(`DELETE FROM "audit_log"`)

  // ── Seed ──────────────────────────────────────────────────────────────────
  const staff = await prisma.user.create({
    data: {
      email: 'tech@example.test',
      passwordHash: 'x',
      fullName: 'Test Tech',
      role: 'STAFF',
    },
  })

  const mensApt = await prisma.apartment.create({
    data: { name: 'Apt 12', cohort: 'MEN' },
  })
  const womensApt = await prisma.apartment.create({
    data: { name: 'Apt 14', cohort: 'WOMEN' },
  })

  const mensBed = await prisma.bed.create({
    data: { apartmentId: mensApt.id, cohort: 'MEN', label: 'A' },
  })
  const womensBed = await prisma.bed.create({
    data: { apartmentId: womensApt.id, cohort: 'WOMEN', label: 'A' },
  })

  const man = await prisma.resident.create({
    data: { firstName: 'Test', lastName: 'Resident-M', cohort: 'MEN' },
  })
  const mansStay = await prisma.stay.create({
    data: { residentId: man.id, cohort: 'MEN', intakeAt: new Date('2026-01-05T12:00:00Z') },
  })

  console.log('\n\x1b[1mCohort separation (composite foreign keys)\x1b[0m')

  const assignment = await mustAllow('a man may be assigned to a bed in a MEN apartment', () =>
    prisma.bedAssignment.create({
      data: {
        bedId: mensBed.id,
        stayId: mansStay.id,
        cohort: 'MEN',
        startedAt: new Date('2026-01-05T12:00:00Z'),
        assignedById: staff.id,
      },
    }),
  )

  await mustReject('a man CANNOT be assigned to a bed in a WOMEN apartment', () =>
    prisma.bedAssignment.create({
      data: {
        bedId: womensBed.id,
        stayId: mansStay.id,
        cohort: 'MEN',
        startedAt: new Date(),
        assignedById: staff.id,
      },
    }),
  )

  await mustReject('…nor by lying about the cohort on the assignment row', () =>
    prisma.bedAssignment.create({
      data: {
        bedId: womensBed.id,
        stayId: mansStay.id,
        cohort: 'WOMEN',
        startedAt: new Date(),
        assignedById: staff.id,
      },
    }),
  )

  await mustReject('a bed CANNOT claim a cohort its apartment does not have', () =>
    prisma.bed.create({
      data: { apartmentId: mensApt.id, cohort: 'WOMEN', label: 'Z' },
    }),
  )

  await mustReject('an occupied apartment CANNOT have its cohort flipped', () =>
    prisma.$executeRawUnsafe(
      `UPDATE "apartments" SET "cohort"='WOMEN' WHERE "id"='${mensApt.id}'`,
    ),
  )

  console.log('\n\x1b[1mBed occupancy (partial unique indexes)\x1b[0m')

  const man2 = await prisma.resident.create({
    data: { firstName: 'Second', lastName: 'Resident-M', cohort: 'MEN' },
  })
  const man2Stay = await prisma.stay.create({
    data: { residentId: man2.id, cohort: 'MEN', intakeAt: new Date() },
  })

  await mustReject('a bed CANNOT hold two live assignments', () =>
    prisma.bedAssignment.create({
      data: {
        bedId: mensBed.id,
        stayId: man2Stay.id,
        cohort: 'MEN',
        startedAt: new Date(),
        assignedById: staff.id,
      },
    }),
  )

  const mensBed2 = await prisma.bed.create({
    data: { apartmentId: mensApt.id, cohort: 'MEN', label: 'B' },
  })
  await mustReject('a stay CANNOT occupy two beds at once', () =>
    prisma.bedAssignment.create({
      data: {
        bedId: mensBed2.id,
        stayId: mansStay.id,
        cohort: 'MEN',
        startedAt: new Date(),
        assignedById: staff.id,
      },
    }),
  )

  console.log('\n\x1b[1mBed history is permanent\x1b[0m')

  await mustReject('a bed assignment CANNOT be deleted', () =>
    prisma.$executeRawUnsafe(`DELETE FROM "bed_assignments" WHERE "id"='${assignment.id}'`),
  )

  await mustReject('who was in the bed CANNOT be rewritten', () =>
    prisma.$executeRawUnsafe(
      `UPDATE "bed_assignments" SET "stayId"='${man2Stay.id}' WHERE "id"='${assignment.id}'`,
    ),
  )

  await mustReject('when the assignment started CANNOT be rewritten', () =>
    prisma.$executeRawUnsafe(
      `UPDATE "bed_assignments" SET "startedAt"=NOW() WHERE "id"='${assignment.id}'`,
    ),
  )

  await mustAllow('an assignment CAN be closed (endedAt/endedReason)', () =>
    prisma.$executeRawUnsafe(
      `UPDATE "bed_assignments" SET "endedAt"=NOW(), "endedReason"='transfer'
       WHERE "id"='${assignment.id}'`,
    ),
  )

  await mustReject('a closed assignment CANNOT be reopened', () =>
    prisma.$executeRawUnsafe(
      `UPDATE "bed_assignments" SET "endedAt"=NULL WHERE "id"='${assignment.id}'`,
    ),
  )

  await mustAllow('the freed bed CAN now be reassigned', () =>
    prisma.bedAssignment.create({
      data: {
        bedId: mensBed.id,
        stayId: man2Stay.id,
        cohort: 'MEN',
        startedAt: new Date(),
        assignedById: staff.id,
      },
    }),
  )

  console.log('\n\x1b[1mAudit log is append-only\x1b[0m')

  const anEntry = await prisma.auditLog.findFirst()
  if (!anEntry) {
    bad('audit entries were written by the extension', 'no audit rows found at all')
  } else {
    ok('audit entries were written by the extension')
    await mustReject('an audit entry CANNOT be updated', () =>
      prisma.$executeRawUnsafe(
        `UPDATE "audit_log" SET "action"='READ' WHERE "id"='${anEntry.id}'`,
      ),
    )
    await mustReject('an audit entry CANNOT be deleted', () =>
      prisma.$executeRawUnsafe(`DELETE FROM "audit_log" WHERE "id"='${anEntry.id}'`),
    )
  }

  console.log('\n\x1b[1mSoft delete (client extension)\x1b[0m')

  const doomed = await prisma.resident.create({
    data: { firstName: 'Soft', lastName: 'Deleted', cohort: 'WOMEN' },
  })
  await prisma.resident.delete({ where: { id: doomed.id } })

  const stillThere = await prisma.$queryRawUnsafe(
    `SELECT "deletedAt" FROM "residents" WHERE "id"='${doomed.id}'`,
  )
  if (stillThere.length === 1 && stillThere[0].deletedAt) {
    ok('delete() retained the row and set deletedAt')
  } else {
    bad('delete() retained the row and set deletedAt', JSON.stringify(stillThere))
  }

  const found = await prisma.resident.findUnique({ where: { id: doomed.id } })
  found === null
    ? ok('findUnique() hides the soft-deleted record')
    : bad('findUnique() hides the soft-deleted record', 'record was returned')

  const list = await prisma.resident.findMany({ where: { lastName: 'Deleted' } })
  list.length === 0
    ? ok('findMany() hides the soft-deleted record')
    : bad('findMany() hides the soft-deleted record', `${list.length} returned`)

  console.log('\n\x1b[1mAudit context\x1b[0m')

  await runWithRequestContext(
    {
      actorId: staff.id,
      actorRole: 'STAFF',
      ipAddress: '10.0.0.5',
      userAgent: 'verify-script',
      requestId: 'test-request-1',
    },
    async () => {
      await prisma.resident.findMany({ take: 1 })
    },
  )
  const ctxEntry = await prisma.auditLog.findFirst({ where: { requestId: 'test-request-1' } })
  if (ctxEntry?.actorId === staff.id && ctxEntry.ipAddress === '10.0.0.5') {
    ok('audit rows carry actor, ip and request id from AsyncLocalStorage')
  } else {
    bad('audit rows carry actor context', JSON.stringify(ctxEntry))
  }

  console.log(`\n  (audit rows written so far: ${await prisma.auditLog.count()})`)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  process.exit(fail === 0 ? 0 : 1)
}

runAsSystem(main).catch((e) => {
  console.error('\nverification crashed:', e)
  process.exit(1)
})
