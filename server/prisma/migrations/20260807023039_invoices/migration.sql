-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- AlterTable
ALTER TABLE "residents" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "stripeInvoiceId" TEXT,
    "number" TEXT,
    "hostedUrl" TEXT,
    "issuedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "sentById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_stripeInvoiceId_key" ON "invoices"("stripeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_stayId_createdAt_idx" ON "invoices"("stayId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "invoices_status_dueAt_idx" ON "invoices"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_ledgerEntryId_key" ON "invoice_lines"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "residents_stripeCustomerId_key" ON "residents"("stripeCustomerId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below. None of it is expressible in schema.prisma, and it is
-- what lets an invoice be evidence rather than a row somebody can edit.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The shape of an invoice ─────────────────────────────────────────────

-- An invoice for nothing is a document nobody meant to create — and in Stripe
-- it is a real object that then has to be voided.
ALTER TABLE "invoices" ADD CONSTRAINT "invoice_total_positive"
  CHECK ("totalCents" > 0);

-- A due date behind the invoice's own creation would be born overdue, lighting
-- the record's loudest dot on arrival.
--
-- The five minutes of tolerance are not slop. Invoices are DUE ON RECEIPT, so
-- `dueAt` and `createdAt` are meant to be the same instant — but `dueAt` comes
-- from the app's clock and `createdAt` from the database's DEFAULT now(),
-- milliseconds later, so a bare `>=` refuses every ordinary send. What this
-- constraint is actually for is catching a due date set to LAST WEEK by
-- mistake, and it still does.
ALTER TABLE "invoices" ADD CONSTRAINT "invoice_due_not_before_creation"
  CHECK ("dueAt" >= "createdAt" - interval '5 minutes');

-- Equivalences, so neither side can drift from the other. `status` is NOT NULL
-- so there is no NULL trap in these two.
ALTER TABLE "invoices" ADD CONSTRAINT "invoice_paid_iff_paid_at"
  CHECK (("status" = 'PAID') = ("paidAt" IS NOT NULL));
ALTER TABLE "invoices" ADD CONSTRAINT "invoice_void_iff_voided_at"
  CHECK (("status" = 'VOID') = ("voidedAt" IS NOT NULL));

-- Voiding strands an invoice's lines permanently — they are never re-billable
-- — so it says why. Explicit IS NOT NULL, per issue #1.
ALTER TABLE "invoices" ADD CONSTRAINT "invoice_void_reason_present"
  CHECK ("status" <> 'VOID'
      OR ("voidReason" IS NOT NULL AND length(btrim("voidReason")) > 0));

-- Anything past DRAFT has been to Stripe and carries what Stripe gave it.
-- A DRAFT that was voided before Stripe ever saw it is the one exception.
ALTER TABLE "invoices" ADD CONSTRAINT "invoice_stripe_ids_paired"
  CHECK (
    ("status" IN ('DRAFT', 'VOID')
       AND ("stripeInvoiceId" IS NULL) = ("finalizedAt" IS NULL))
    OR ("status" NOT IN ('DRAFT', 'VOID')
       AND "stripeInvoiceId" IS NOT NULL AND "finalizedAt" IS NOT NULL
       AND "hostedUrl" IS NOT NULL AND "issuedAt" IS NOT NULL)
  );

-- ── 2. THE SNAPSHOT IS IMMUTABLE, BY THE DATABASE ──────────────────────────
--
-- CLAUDE.md module 11 says an invoice total "is NOT a cached balance — it is a
-- snapshot of what was billed on the day it was sent, which must not move when
-- a later correction lands."
--
-- Prose cannot enforce that. This does: drug_screens' posture — a SCOPED update
-- grant written as a WHOLE-ROW jsonb comparison, so a column added in six
-- months is immutable BY DEFAULT. "totalCents", "stayId", "dueAt" and
-- "sentById" sit OUTSIDE the whitelist, so nothing can move them: not a route,
-- not a script, not a psql session.
--
-- THAT is the difference between a snapshot and a cache. A cache is a value
-- something recomputes. This one cannot be recomputed by anything.
CREATE OR REPLACE FUNCTION "invoices_stripe_arc"() RETURNS TRIGGER AS $$
DECLARE arc TEXT[] := ARRAY[
  'status','stripeInvoiceId','number','hostedUrl',
  'issuedAt','finalizedAt','paidAt','voidedAt','voidReason'];
BEGIN
  IF (to_jsonb(NEW) - arc) IS DISTINCT FROM (to_jsonb(OLD) - arc) THEN
    RAISE EXCEPTION 'an invoice is immutable apart from its Stripe arc: the billed total is a snapshot and never moves. Correct a mistake in the LEDGER (a new entry with correctsId), which lands unbilled and flows onto the next invoice.';
  END IF;

  -- Finalization. Once bound to a Stripe invoice it keeps THAT one forever;
  -- a rebind is the double-billing this guard exists to catch.
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'OPEN' THEN
    IF OLD."stripeInvoiceId" IS NOT NULL
       AND NEW."stripeInvoiceId" IS DISTINCT FROM OLD."stripeInvoiceId" THEN
      RAISE EXCEPTION 'this invoice is already bound to a Stripe invoice';
    END IF;
    RETURN NEW;
  END IF;

  -- A draft Stripe never accepted may be abandoned. Its lines stay billed —
  -- deliberately; see the invoice_lines note below.
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'VOID' THEN RETURN NEW; END IF;

  -- The outcomes, from Stripe, once each.
  IF OLD."status" = 'OPEN' AND NEW."status" IN ('PAID', 'VOID', 'UNCOLLECTIBLE') THEN
    IF NEW."stripeInvoiceId" IS DISTINCT FROM OLD."stripeInvoiceId"
       OR NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt" THEN
      RAISE EXCEPTION 'an outcome cannot rewrite the finalization it followed';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'the invoice arc runs DRAFT -> OPEN -> PAID|VOID|UNCOLLECTIBLE, once and one way (attempted % -> %)',
    OLD."status", NEW."status";
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "invoices_arc_only" BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_stripe_arc"();

CREATE OR REPLACE FUNCTION "invoices_are_never_deleted"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'an invoice is never deleted: void it, with a reason.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "invoices_no_delete" BEFORE DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_are_never_deleted"();

-- ── 3. invoice_lines is append-only, like ledger_entries itself ────────────
--
-- Module 11: marking a ledger line billed would be an UPDATE, and
-- ledger_entries refuses those by trigger AND by revoked privilege. The link
-- is its own table instead, so "unbilled" is a READ — no row here — and the
-- ledger keeps its no-update guarantee untouched.
CREATE OR REPLACE FUNCTION "invoice_lines_is_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'invoice_lines is append-only: % is not permitted. A line is billed exactly once, forever.', TG_OP;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_lines_no_update" BEFORE UPDATE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "invoice_lines_is_append_only"();
CREATE TRIGGER "invoice_lines_no_delete" BEFORE DELETE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "invoice_lines_is_append_only"();

-- ── 4. A line is billable, and stays inside its invoice's stay ────────────
-- Cross-row, so a trigger — the ledger_correction_same_stay idiom.
CREATE OR REPLACE FUNCTION "invoice_line_is_billable"() RETURNS TRIGGER AS $$
DECLARE entry_stay TEXT; entry_type "LedgerEntryType"; inv_stay TEXT; inv_status "InvoiceStatus";
BEGIN
  SELECT "stayId", "type" INTO entry_stay, entry_type
    FROM "ledger_entries" WHERE "id" = NEW."ledgerEntryId";
  SELECT "stayId", "status" INTO inv_stay, inv_status
    FROM "invoices" WHERE "id" = NEW."invoiceId";

  IF entry_stay IS DISTINCT FROM inv_stay THEN
    RAISE EXCEPTION 'an invoice line must reference a ledger entry on the same stay';
  END IF;

  -- A CHARGE asks for money and a CREDIT reduces what is asked. A PAYMENT is
  -- money already received — billing it would demand it twice.
  IF entry_type NOT IN ('CHARGE', 'CREDIT') THEN
    RAISE EXCEPTION 'only a charge or a credit is billable: a payment is money already received, not a line on a demand for money';
  END IF;

  -- A line appended after finalization would make totalCents stop matching the
  -- lines beneath it — the exact drift the snapshot exists to prevent,
  -- arriving through the one door left open.
  IF inv_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'this invoice has been finalized; its lines are settled';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_line_billable" BEFORE INSERT ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "invoice_line_is_billable"();

-- ── 5. Row-level security ──────────────────────────────────────────────────
-- ledger_entries' shape: staff, or the resident's own through the stay. A
-- resident is entitled to their own bill, and writing the true rule now is why
-- the resident portal will need no policy rewrite later.
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_read ON "invoices" FOR SELECT
  USING (app_is_staff() OR EXISTS (
    SELECT 1 FROM "stays" s WHERE s."id" = "invoices"."stayId"
       AND s."residentId" = app_resident_id()));
CREATE POLICY invoices_write ON "invoices" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_lines_read ON "invoice_lines" FOR SELECT
  USING (app_is_staff() OR EXISTS (
    SELECT 1 FROM "invoices" i JOIN "stays" s ON s."id" = i."stayId"
     WHERE i."id" = "invoice_lines"."invoiceId"
       AND s."residentId" = app_resident_id()));
CREATE POLICY invoice_lines_write ON "invoice_lines" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- stripe_events holds no resident data — an event id and a type — but it is
-- written by the webhook under runAsSystem, so it needs a policy to be
-- reachable at all under FORCE.
ALTER TABLE "stripe_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY stripe_events_all ON "stripe_events" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- The privilege AGREES with the triggers rather than relying on them: the app
-- role fails on privilege before a trigger is reached, and a superuser — which
-- bypasses RLS even with FORCE — fails on the trigger. Note "totalCents" is
-- NOT in the grant.
REVOKE UPDATE, DELETE ON "invoices" FROM soberlife_app;
GRANT UPDATE ("status", "stripeInvoiceId", "number", "hostedUrl",
              "issuedAt", "finalizedAt", "paidAt", "voidedAt", "voidReason")
  ON "invoices" TO soberlife_app;

REVOKE UPDATE, DELETE ON "invoice_lines" FROM soberlife_app;
