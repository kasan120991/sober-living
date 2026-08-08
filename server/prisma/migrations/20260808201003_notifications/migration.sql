-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('PASS_REQUESTED', 'MAINTENANCE_FILED', 'SERVICE_HOURS_LOGGED', 'PAYMENT_RECEIVED', 'INVOICE_SENT', 'NOT_FOUND_ON_ROUND');

-- CreateEnum
CREATE TYPE "NotificationClass" AS ENUM ('REQUEST', 'MONEY', 'SAFETY');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "NotificationKind" NOT NULL,
    "class" "NotificationClass" NOT NULL,
    "roles" "StaffRole"[],
    "residentId" TEXT,
    "actorId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "to" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_seen" (
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_seen_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "notifications_at_idx" ON "notifications"("at");

-- CreateIndex
CREATE INDEX "notifications_residentId_at_idx" ON "notifications"("residentId", "at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_seen" ADD CONSTRAINT "notification_seen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below this line. See CLAUDE.md module 12.
--
-- This table REVERSES "There is no Notification table, deliberately" — for
-- EVENTS ONLY, and against the four conditions module 12 named for its own
-- reversal. The derived situations are untouched and still clear themselves;
-- what lands here is what just happened, which nothing derived can express
-- because the socket carries `{ at }` and has no replay.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. `roles` is NOT NULL with an empty default ──────────────────────────
--
-- Prisma emits a scalar list as a NULLABLE column with NO default. That
-- matters beyond tidiness: `cardinality(NULL)` is NULL and a CHECK constraint
-- passes on NULL, so the recipient guard below would wave a NULL straight
-- through. This is CLAUDE.md's module 5 `substances` warning, verbatim, and
-- the second table to need it.
ALTER TABLE "notifications" ALTER COLUMN "roles" SET NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"StaffRole"[];

-- ── 2. Every event must reach somebody ────────────────────────────────────
--
-- Routing is a predicate evaluated at read time, so an event with no roles and
-- no resident is not "broadcast to all" — it is addressed to nobody and read
-- by nobody. That is a silent bug: the write succeeds, the act is recorded,
-- and no one is ever told. Refuse it at the table.
ALTER TABLE "notifications" ADD CONSTRAINT "notification_has_a_recipient"
  CHECK (cardinality("roles") > 0 OR "residentId" IS NOT NULL);

-- ── 3. Append-only, at both layers ────────────────────────────────────────
--
-- Two layers because they stop different things: the REVOKE stops the app role
-- on privilege, the trigger stops a superuser — which bypasses RLS even with
-- FORCE. verify-notifications.js asserts them separately; a test that
-- conflates the two proves neither.
--
-- No column-level GRANT survives the REVOKE, unlike drug_screens or
-- travel_passes: those have an arc to transition and this has nothing at all.
-- An event is a statement about a moment. There is nothing to correct, and
-- nothing needs correcting — the SITUATION it describes is still derived
-- elsewhere and still clears itself, which is exactly what buys this table the
-- right to be permanent.
CREATE OR REPLACE FUNCTION "notifications_are_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'notifications are append-only: an event is a statement about a moment. The situation it describes is derived elsewhere and clears itself.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "notifications_no_update" BEFORE UPDATE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION "notifications_are_append_only"();
CREATE TRIGGER "notifications_no_delete" BEFORE DELETE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION "notifications_are_append_only"();

REVOKE UPDATE, DELETE ON "notifications" FROM soberlife_app;

-- `notification_seen` is deliberately NOT revoked. A watermark is current
-- state, not a new fact about the past — the medications / maintenance_requests
-- split, where the record stays updatable and only the trail is frozen.

-- ── 4. Row-level security ─────────────────────────────────────────────────
--
-- Staff read everything; a resident reads only events addressed to them by
-- name. The resident half is unreachable today — no RESIDENT account can be
-- created — and is written now because the portal is the reason this column
-- exists, and a policy added later is a policy somebody has to remember.
--
-- Note the routing itself is NOT enforced here: the `roles` filter lives in
-- feedFor()'s where clause, because RLS reads `app.actor_kind` and
-- `app.resident_id` and there is no `app.user_id` or `app.role` GUC to key a
-- per-role policy on. RLS is the backstop for WHOSE data; the route is the
-- gate for WHICH staff role. verify-notifications.js asserts the role split
-- through the API, which is where it lives.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY notifications_read ON "notifications" FOR SELECT
  USING (app_is_staff() OR "residentId" = app_resident_id());
CREATE POLICY notifications_write ON "notifications" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- `notification_seen` gets NO policy, and that is the users/sessions rule
-- rather than an oversight: it is per-USER state, and RLS here would need an
-- `app.user_id` setting that dbContext.js does not carry. The route only ever
-- reads and writes req.session.userId, so a user cannot address another's
-- watermark. Adding the GUC is the deliberate change if that ever stops being
-- true.
