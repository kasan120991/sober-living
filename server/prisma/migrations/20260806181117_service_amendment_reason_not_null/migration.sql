-- Fixes issue #1: service_amendment_reason_paired did not actually refuse a
-- NULL reason.
--
-- With supersedesId set and amendmentReason NULL the first branch is FALSE and
-- the second is NULL — length(btrim(NULL)) is NULL — so the whole expression is
-- NULL, and A CHECK CONSTRAINT PASSES ON NULL. It only rejects on FALSE.
--
-- Nothing reached this through the app: the route requires the reason. But this
-- table's guards exist precisely because "the app would not do that" is not the
-- standard an append-only record is held to — a direct psql session, a backfill
-- or a future script would have slipped straight through.
--
-- The original migration is immutable, so this REPLACES the constraint rather
-- than editing it. Module 4's check_amendment_reason_paired already carries the
-- explicit IS NOT NULL; this brings module 7 into line with it.

ALTER TABLE "service_entries" DROP CONSTRAINT "service_amendment_reason_paired";

ALTER TABLE "service_entries" ADD CONSTRAINT "service_amendment_reason_paired"
  CHECK (("supersedesId" IS NULL AND "amendmentReason" IS NULL)
      OR ("supersedesId" IS NOT NULL AND "amendmentReason" IS NOT NULL
          AND length(btrim("amendmentReason")) > 0));
