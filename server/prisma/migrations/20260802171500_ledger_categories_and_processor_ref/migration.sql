-- CreateEnum
CREATE TYPE "LedgerCategory" AS ENUM ('RENT', 'LAUNDRY', 'TRIP', 'PROGRAM_FEE', 'DAMAGE', 'OTHER');

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "category" "LedgerCategory",
ADD COLUMN     "externalRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_externalRef_key" ON "ledger_entries"("externalRef");


-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below.
--
-- The ledger turned out not to be a rent ledger. A resident's balance carries
-- laundry, trip fees, program fees and damages, and payment will arrive through
-- Stripe rather than only across the office desk. Both facts change what has to
-- be true of a row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A charge says what it is for; a payment does not ───────────────────────
-- "How much did we bill in laundry last quarter" must not be answerable only by
-- grepping free text. Conversely a category on a PAYMENT would invite the idea
-- that a payment pays off one category, which is not how a balance works here —
-- money received reduces what is owed, full stop.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_category_matches_type" CHECK (
  ("type" = 'CHARGE' AND "category" IS NOT NULL)
  OR ("type" <> 'CHARGE' AND "category" IS NULL)
);

-- ── A processor reference belongs to money actually received ───────────────
-- A Stripe PaymentIntent on a CHARGE would mean the charge itself was somehow
-- settled, which is a category error: the charge is what created the debt.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_external_ref_is_payment" CHECK (
  "externalRef" IS NULL OR "type" = 'PAYMENT'
);

-- Note the UNIQUE index on "externalRef" that Prisma generated above is load
-- bearing, not housekeeping. Processor webhooks are delivered at-least-once and
-- this table cannot be corrected by deleting a row, so without it a single
-- retried Stripe webhook is a permanent duplicate payment against a resident's
-- balance. Postgres allows many NULLs in a unique index, so cash and cheques
-- are unaffected. The insert failing IS the desired behaviour — the handler
-- should treat a unique violation here as "already recorded", not as an error.
