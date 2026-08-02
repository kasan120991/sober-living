/**
 * Clears facility data while KEEPING accounts that were created deliberately.
 *
 * Shared by seed.js and verify-constraints.js. It exists as one function
 * because it previously existed as two: seed.js was taught to preserve real
 * accounts and verify-constraints.js was not, so running the suites silently
 * destroyed the administrator's login.
 *
 * "Test account" means any address on a `.test` TLD — reserved by RFC 2606 for
 * exactly this. Real accounts use real domains and survive.
 *
 * The TRUNCATE/DELETE split is load-bearing:
 *   - `bed_assignments`, `audit_log` and `ledger_entries` have triggers that
 *     REFUSE DELETE, so they can only be cleared with TRUNCATE, which does not
 *     fire row triggers.
 *   - `residents` must be DELETEd, not TRUNCATEd. `users.residentId` references
 *     it, so TRUNCATE ... CASCADE would take `users` with it — which is exactly
 *     what this function exists to prevent.
 */
export async function resetFacilityData(prisma, { quiet = false } = {}) {
  const sql = (q) => prisma.$executeRawUnsafe(q)

  // ledger_entries goes in this list, not the DELETE list below, for the same
  // reason as bed_assignments: its append-only trigger refuses DELETE outright.
  // It must also be cleared BEFORE stays, which it references.
  await sql('TRUNCATE "ledger_entries", "bed_assignments", "sessions", "audit_log" RESTART IDENTITY')

  await sql('DELETE FROM "documents"')
  await sql('DELETE FROM "emergency_contacts"')
  await sql('DELETE FROM "insurance_policies"')
  await sql('DELETE FROM "stays"')
  await sql('DELETE FROM "maintenance_requests"')
  await sql('DELETE FROM "beds"')
  await sql('DELETE FROM "apartments"')
  await sql('DELETE FROM "programs"')

  // Release resident account links before the residents go.
  await sql('UPDATE "users" SET "residentId" = NULL WHERE "residentId" IS NOT NULL')
  await sql('DELETE FROM "residents"')

  const removed = await sql(`DELETE FROM "users" WHERE "email" LIKE '%.test'`)
  const kept = await prisma.user.count()
  if (!quiet) {
    console.log(`  reset: removed ${removed} test account(s), kept ${kept} real account(s)`)
  }
  return { removed, kept }
}
