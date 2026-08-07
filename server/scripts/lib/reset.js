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
  // service_entries joins this list rather than the DELETE list below for the
  // same reason as ledger_entries: its never-DELETE trigger refuses row
  // deletion even to the owner, and TRUNCATE does not fire row triggers. It
  // must also be cleared BEFORE stays, which it references.
  // apartment_check_residents and apartment_checks join for the same reason
  // again — their append-only triggers refuse DELETE even to the owner — and
  // clear BEFORE stays and apartments, which they reference.
  // drug_screens leads the list: its never-DELETE trigger refuses row deletion
  // even to the owner, and it references BOTH stays and ledger_entries, so it
  // must be cleared before either.
  // invoice_lines and invoices lead: both refuse DELETE by trigger even to the
  // owner, and both reference ledger_entries and stays, so they clear first.
  await sql(
    // maintenance_events joins the TRUNCATE list for the same reason as the
    // others: its append-only trigger refuses DELETE even to the owner, and it
    // references maintenance_requests, so it must clear before them.
    'TRUNCATE "invoice_lines", "invoices", "stripe_events", "drug_screens", "apartment_check_residents", "apartment_checks", "maintenance_events", "service_entries", "ledger_entries", "bed_assignments", "sessions", "audit_log" RESTART IDENTITY',
  )

  // The schedule, in foreign-key order and all of it BEFORE stays, which the
  // attendee and attendance rows reference. Plain DELETE throughout: all five
  // revoke DELETE from the app role, but this runs as the owner.
  await sql('DELETE FROM "schedule_attendance"')
  await sql('DELETE FROM "schedule_attendees"')
  await sql('DELETE FROM "schedule_sessions"')
  await sql('DELETE FROM "schedule_occurrences"')
  await sql('DELETE FROM "schedule_events"')

  // Before stays, which it references. Plain DELETE: sign_outs revokes DELETE
  // from the app role, but this runs as the owner.
  await sql('DELETE FROM "sign_outs"')
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
