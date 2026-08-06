-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('ONCE', 'WEEKLY');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('ATTENDED', 'ABSENT', 'EXCUSED');

-- CreateTable
CREATE TABLE "schedule_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "schedule_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_occurrences" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "cohort" "Cohort" NOT NULL,
    "startsAtLocal" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "recurrence" "Recurrence" NOT NULL,
    "weekdays" INTEGER[],
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "schedule_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_sessions" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "cohort" "Cohort" NOT NULL,
    "sessionDate" DATE NOT NULL,
    "startsAtLocalOverride" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "attendanceTakenAt" TIMESTAMP(3),
    "attendanceTakenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_attendees" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "cohort" "Cohort" NOT NULL,
    "stayId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "schedule_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_attendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "cohort" "Cohort" NOT NULL,
    "stayId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_occurrences_cohort_startsOn_idx" ON "schedule_occurrences"("cohort", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_occurrences_id_cohort_key" ON "schedule_occurrences"("id", "cohort");

-- CreateIndex
CREATE INDEX "schedule_sessions_sessionDate_idx" ON "schedule_sessions"("sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_sessions_occurrenceId_sessionDate_key" ON "schedule_sessions"("occurrenceId", "sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_sessions_id_cohort_key" ON "schedule_sessions"("id", "cohort");

-- CreateIndex
CREATE INDEX "schedule_attendees_stayId_idx" ON "schedule_attendees"("stayId");

-- CreateIndex
CREATE INDEX "schedule_attendance_stayId_createdAt_idx" ON "schedule_attendance"("stayId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_attendance_sessionId_stayId_key" ON "schedule_attendance"("sessionId", "stayId");

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "schedule_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "schedule_sessions_occurrenceId_cohort_fkey" FOREIGN KEY ("occurrenceId", "cohort") REFERENCES "schedule_occurrences"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "schedule_sessions_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "schedule_sessions_attendanceTakenById_fkey" FOREIGN KEY ("attendanceTakenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_attendees" ADD CONSTRAINT "schedule_attendees_occurrenceId_cohort_fkey" FOREIGN KEY ("occurrenceId", "cohort") REFERENCES "schedule_occurrences"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_attendees" ADD CONSTRAINT "schedule_attendees_stayId_cohort_fkey" FOREIGN KEY ("stayId", "cohort") REFERENCES "stays"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_attendees" ADD CONSTRAINT "schedule_attendees_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_attendance" ADD CONSTRAINT "schedule_attendance_sessionId_cohort_fkey" FOREIGN KEY ("sessionId", "cohort") REFERENCES "schedule_sessions"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_attendance" ADD CONSTRAINT "schedule_attendance_stayId_cohort_fkey" FOREIGN KEY ("stayId", "cohort") REFERENCES "stays"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_attendance" ADD CONSTRAINT "schedule_attendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────
-- Everything below is hand-written. Prisma cannot express partial unique
-- indexes, CHECK constraints or RLS policies, and CLAUDE.md requires them
-- added to the generated migration BEFORE it is applied.
-- ──────────────────────────────────────────────────────────────────────────

-- Partial, not @@unique, precisely BECAUSE these tables are soft-deletable.
-- A plain unique index would refuse to re-add a cohort that had been removed,
-- or a resident who had been taken off a group and put back.
CREATE UNIQUE INDEX "one_live_occurrence_per_event_cohort"
  ON "schedule_occurrences" ("eventId", "cohort") WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "one_live_attendee_per_occurrence"
  ON "schedule_attendees" ("occurrenceId", "stayId") WHERE "deletedAt" IS NULL;

-- Wall-clock format. The service validates it too; this is what holds against
-- a direct psql session, and against a future importer.
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "occurrence_start_is_wall_clock"
  CHECK ("startsAtLocal" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "occurrence_duration_sane"
  CHECK ("durationMinutes" BETWEEN 1 AND 1440);

ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "occurrence_weekdays_valid"
  CHECK ("weekdays" <@ ARRAY[0,1,2,3,4,5,6]);

ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "occurrence_window_ordered"
  CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn");

-- The rule and its fields have to agree. A ONCE carrying weekdays, or a WEEKLY
-- carrying none, is not a schedule — it is a half-filled form that reached the
-- table, and it would expand to either nothing or the wrong thing.
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "occurrence_rule_coherent" CHECK (
  ("recurrence" = 'ONCE'
     AND coalesce(array_length("weekdays", 1), 0) = 0
     AND "endsOn" = "startsOn")
  OR
  ("recurrence" = 'WEEKLY'
     AND coalesce(array_length("weekdays", 1), 0) BETWEEN 1 AND 7)
);

ALTER TABLE "schedule_events" ADD CONSTRAINT "event_title_present"
  CHECK (length(btrim("title")) > 0);

ALTER TABLE "schedule_sessions" ADD CONSTRAINT "session_override_is_wall_clock"
  CHECK ("startsAtLocalOverride" IS NULL
         OR "startsAtLocalOverride" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Pairs that arrive together or not at all — the sign_out_return_acknowledged
-- pattern. A record nobody stands behind is not a record.
ALTER TABLE "schedule_sessions" ADD CONSTRAINT "session_attendance_taken_by"
  CHECK (("attendanceTakenAt" IS NULL) = ("attendanceTakenById" IS NULL));

ALTER TABLE "schedule_sessions" ADD CONSTRAINT "session_cancelled_by"
  CHECK (("cancelledAt" IS NULL) = ("cancelledById" IS NULL));

-- ── Row-level security ────────────────────────────────────────────────────
-- New tables get GRANTs automatically via ALTER DEFAULT PRIVILEGES, but NOT
-- policies. Without the blocks below every one of these would be readable by
-- any actor, including a RESIDENT.
--
-- schedule_attendees and schedule_attendance are resident data and take the
-- stay-scoped template from the sign_outs migration verbatim.
--
-- The other three are facility configuration, and are gated anyway — scoped
-- THROUGH attendance. That is what makes CLAUDE.md's rule ("a resident's
-- schedule is a join through attendance, not through cohort") true at the
-- database level rather than only in a service, and it is what stops a future
-- resident portal enumerating the other cohort's meeting times.

ALTER TABLE "schedule_attendees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_attendees" FORCE ROW LEVEL SECURITY;

CREATE POLICY schedule_attendees_read ON "schedule_attendees" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (SELECT 1 FROM "stays" s
        WHERE s."id" = "schedule_attendees"."stayId" AND s."residentId" = app_resident_id())
  );

CREATE POLICY schedule_attendees_write ON "schedule_attendees" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

REVOKE DELETE ON "schedule_attendees" FROM soberlife_app;

ALTER TABLE "schedule_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_attendance" FORCE ROW LEVEL SECURITY;

CREATE POLICY schedule_attendance_read ON "schedule_attendance" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (SELECT 1 FROM "stays" s
        WHERE s."id" = "schedule_attendance"."stayId" AND s."residentId" = app_resident_id())
  );

CREATE POLICY schedule_attendance_write ON "schedule_attendance" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- A mark is corrected by changing its status, never removed. UPDATE stays
-- granted; DELETE is never legitimate.
REVOKE DELETE ON "schedule_attendance" FROM soberlife_app;

ALTER TABLE "schedule_occurrences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_occurrences" FORCE ROW LEVEL SECURITY;

CREATE POLICY schedule_occurrences_read ON "schedule_occurrences" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (
      SELECT 1 FROM "schedule_attendees" a
        JOIN "stays" s ON s."id" = a."stayId"
       WHERE a."occurrenceId" = "schedule_occurrences"."id"
         AND a."deletedAt" IS NULL
         AND s."residentId" = app_resident_id())
  );

CREATE POLICY schedule_occurrences_write ON "schedule_occurrences" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

REVOKE DELETE ON "schedule_occurrences" FROM soberlife_app;

ALTER TABLE "schedule_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY schedule_sessions_read ON "schedule_sessions" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (
      SELECT 1 FROM "schedule_attendees" a
        JOIN "stays" s ON s."id" = a."stayId"
       WHERE a."occurrenceId" = "schedule_sessions"."occurrenceId"
         AND a."deletedAt" IS NULL
         AND s."residentId" = app_resident_id())
  );

CREATE POLICY schedule_sessions_write ON "schedule_sessions" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- A session exists because it carries a record. Cancel is the operation.
REVOKE DELETE ON "schedule_sessions" FROM soberlife_app;

ALTER TABLE "schedule_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY schedule_events_read ON "schedule_events" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (
      SELECT 1 FROM "schedule_occurrences" o
        JOIN "schedule_attendees" a ON a."occurrenceId" = o."id" AND a."deletedAt" IS NULL
        JOIN "stays" s ON s."id" = a."stayId"
       WHERE o."eventId" = "schedule_events"."id"
         AND o."deletedAt" IS NULL
         AND s."residentId" = app_resident_id())
  );

CREATE POLICY schedule_events_write ON "schedule_events" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

REVOKE DELETE ON "schedule_events" FROM soberlife_app;
