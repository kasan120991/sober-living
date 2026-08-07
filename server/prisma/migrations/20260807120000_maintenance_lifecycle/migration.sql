-- CreateEnum
CREATE TYPE "MaintenanceEventKind" AS ENUM ('CLOSED', 'REOPENED');

-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "vendorName" TEXT,
ADD COLUMN     "workOrderRef" TEXT;

-- CreateTable
CREATE TABLE "maintenance_events" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "MaintenanceEventKind" NOT NULL,
    "closedAs" "MaintenanceStatus",
    "note" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_events_requestId_at_idx" ON "maintenance_events"("requestId", "at");

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below. The backfill MUST run before the columns are dropped,
-- which is the whole reason this migration is written by hand rather than
-- generated: `prisma migrate dev` would have dropped three columns holding the
-- only record of every closure the facility has ever made.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Carry every existing closure into the trail ─────────────────────────

-- A request that is RESOLVED or CANCELLED today was closed by somebody, and
-- that fact lives in the columns about to be dropped. `at` falls back to
-- updatedAt and the actor to whoever reported it, because both resolved
-- columns are nullable and a closed request with a null resolvedById is
-- reachable in the current data. The placeholder note is deliberately a
-- sentence rather than an empty string: the CHECK below refuses blank, and a
-- closure whose note was never recorded should say so rather than look like
-- one that was.
INSERT INTO "maintenance_events" ("id", "requestId", "kind", "closedAs", "note", "actorId", "at")
SELECT
  gen_random_uuid()::text,
  "id",
  'CLOSED',
  "status",
  COALESCE(
    NULLIF(btrim("resolutionNote"), ''),
    'Closed before the trail existed; no note was recorded at the time.'
  ),
  COALESCE("resolvedById", "reportedById"),
  COALESCE("resolvedAt", "updatedAt")
FROM "maintenance_requests"
WHERE "status" IN ('RESOLVED', 'CANCELLED');

-- ── 2. Now the columns can go ──────────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "maintenance_requests" DROP CONSTRAINT "maintenance_requests_resolvedById_fkey";

-- AlterTable
ALTER TABLE "maintenance_requests" DROP COLUMN "resolvedAt",
DROP COLUMN "resolvedById",
DROP COLUMN "resolutionNote";

-- ── 3. IN_PROGRESS means somebody owns it ──────────────────────────────────

-- The state was in the enum and unreachable from any screen for five days
-- because it carried no information. It carries an owner now, and this is what
-- stops it drifting back into a synonym for OPEN. The vendor branch spells out
-- IS NOT NULL for the reason written on check_present_needs_note: a bare
-- length(btrim(NULL)) is NULL, NULL OR FALSE is NULL, and a CHECK passes on
-- NULL — so without it a vendor name of NULL satisfies the constraint.
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_in_progress_needs_owner"
  CHECK ("status" <> 'IN_PROGRESS'
      OR "assignedToId" IS NOT NULL
      OR ("vendorName" IS NOT NULL AND length(btrim("vendorName")) > 0));

-- ── 4. The shape of a trail row ────────────────────────────────────────────

-- A closure names which closed state it was; a reopening cannot. Without the
-- pairing, `closedAs` would be free to disagree with `kind`, and the read that
-- renders "Resolved by Dana" would be trusting a column nothing constrains.
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_event_closed_as_paired"
  CHECK (("kind" = 'CLOSED' AND "closedAs" IS NOT NULL AND "closedAs" IN ('RESOLVED', 'CANCELLED'))
      OR ("kind" = 'REOPENED' AND "closedAs" IS NULL));

-- THE rule this module exists to keep: a request that just disappears leaves no
-- record of what was actually done to the unit. It lived only in
-- services/maintenance.js until 2026-08-07, which meant any other code path —
-- a script, a future route, a psql session — could close a request silently.
-- The IS NOT NULL is redundant while the column is NOT NULL and is written
-- anyway, so the guarantee survives somebody later making the column nullable.
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_event_needs_note"
  CHECK ("note" IS NOT NULL AND length(btrim("note")) > 0);

-- ── 5. Append-only ─────────────────────────────────────────────────────────

-- apartment_checks' posture verbatim: no transition exists on a trail row, so
-- there is no whitelist and every UPDATE and DELETE is refused. The trigger is
-- what catches a superuser, which bypasses RLS even with FORCE; the REVOKE
-- below is what catches the app role, which fails on privilege before a trigger
-- is ever reached. verify-maintenance.js asserts the two separately, because a
-- test that conflates them proves neither.
--
-- Note the REQUEST table stays freely updatable — status, priority and
-- ownership are current state, not evidence. Only the trail is frozen.
CREATE OR REPLACE FUNCTION "maintenance_events_are_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'maintenance events are append-only: reopening a request appends a REOPENED row, it never edits or deletes the closure it undoes.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "maintenance_events_no_update" BEFORE UPDATE ON "maintenance_events"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_events_are_append_only"();
CREATE TRIGGER "maintenance_events_no_delete" BEFORE DELETE ON "maintenance_events"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_events_are_append_only"();

REVOKE UPDATE, DELETE ON "maintenance_events" FROM soberlife_app;

-- ── 6. No row-level security, deliberately ─────────────────────────────────

-- maintenance_events follows maintenance_requests: facility configuration, not
-- resident data, gated by role in the API — the rule stated in
-- 20260802074220_row_level_security. It holds only because a request names an
-- apartment and never a person, which was re-decided rather than inherited on
-- 2026-08-07. The day a request can name the resident who reported it, both
-- tables need policies and the resident block of AUDITED_MODELS.
GRANT SELECT, INSERT ON "maintenance_events" TO soberlife_app;
