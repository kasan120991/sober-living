-- Editing, moving and ending a schedule event.
--
-- A recurrence rule cannot be edited once anything has been recorded against it.
-- `expand()` gates on `occursOn` BEFORE it looks at materialized session rows, so
-- changing the weekdays of a group with a taken roll makes that session vanish
-- from the board, the roll queue and the resident record while its attendance
-- sits orphaned in `schedule_attendance`, reachable by no read path.
--
-- So "the Tuesday group moved to Thursdays" is not an UPDATE. It ends the old
-- series the day before and starts a new one — which is what happened
-- operationally anyway — and every past date stays covered by its own rule.
-- `supersedesId` is the link between the two.

-- AlterTable
ALTER TABLE "schedule_events" ADD COLUMN     "supersedesId" TEXT,
                              ADD COLUMN     "moveReason" TEXT;

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "schedule_events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A PARTIAL unique index, not the total one Prisma's `@unique` would emit.
--
-- One live successor per event: a forked chain is then structurally impossible,
-- which is why this is one column rather than a pair that could disagree. Scoped
-- to live rows because `schedule_events` is soft-deletable — a successor created
-- in error and then removed must not block the original from being moved again.
--
-- Same reasoning and same shape as "one_live_occurrence_per_event_cohort".
CREATE UNIQUE INDEX "one_live_successor_per_event"
  ON "schedule_events" ("supersedesId")
  WHERE "deletedAt" IS NULL AND "supersedesId" IS NOT NULL;

-- An event cannot supersede itself. The FK permits it; a cycle of one would make
-- the provenance chain unwalkable.
ALTER TABLE "schedule_events" ADD CONSTRAINT "event_no_self_succession"
  CHECK ("supersedesId" IS NULL OR "supersedesId" <> "id");

-- A move reason is meaningless on an event that supersedes nothing. Unlike
-- `service_entries.amendmentReason` the reason itself is OPTIONAL — a court order
-- or a room change is worth recording, swapping the days round needs no ceremony
-- — so this constrains only the direction that cannot be true.
ALTER TABLE "schedule_events" ADD CONSTRAINT "event_move_reason_needs_succession"
  CHECK ("moveReason" IS NULL OR "supersedesId" IS NOT NULL);
