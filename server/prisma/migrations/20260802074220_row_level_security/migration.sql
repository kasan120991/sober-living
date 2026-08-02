-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security on resident data.
--
-- This is the SECOND line of defence. server/src/middleware/authorize.js is
-- still the primary gate; this is what holds when a route is added without the
-- right guard — and CLAUDE.md is explicit that a single missed check here is a
-- 42 CFR Part 2 disclosure, not a bug report.
--
-- Two things make it actually effective:
--
--   1. The application must NOT connect as a superuser or as the table owner.
--      Superusers bypass RLS entirely, and owners bypass it unless FORCE is
--      set. A dedicated `soberlife_app` role is created below for the runtime;
--      the owner role keeps running migrations.
--
--   2. Policies are FAIL-CLOSED. With no actor context set, current_setting
--      returns NULL, every predicate is false, and queries return nothing.
--      Forgetting to set context loses you data; it does not leak it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The runtime role ────────────────────────────────────────────────────────
-- Created without LOGIN and without a password on purpose: a credential in a
-- migration is a credential in git. `npm run db:app-role` grants LOGIN and sets
-- the password from the environment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'soberlife_app') THEN
    CREATE ROLE soberlife_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO soberlife_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO soberlife_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO soberlife_app;

-- Future tables get the same grants, so a new model does not silently become
-- unreadable by the application.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO soberlife_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO soberlife_app;

-- The app must never rewrite history, whatever the ORM asks for. These already
-- have triggers refusing UPDATE/DELETE; removing the privilege too means the
-- attempt fails before the trigger even runs.
REVOKE UPDATE, DELETE ON "audit_log" FROM soberlife_app;
REVOKE DELETE ON "bed_assignments" FROM soberlife_app;

-- ── Helpers: the current actor ──────────────────────────────────────────────
-- `true` on current_setting means "return NULL if unset" rather than erroring.
CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean AS $$
  SELECT current_setting('app.actor_kind', true) = 'staff';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_resident_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.resident_id', true), '');
$$ LANGUAGE sql STABLE;

-- ── Policies ────────────────────────────────────────────────────────────────
-- Resident-scoped tables only. Facility configuration (apartments, beds,
-- maintenance) is not resident data and is gated by role in the API instead.

ALTER TABLE "residents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "residents" FORCE ROW LEVEL SECURITY;
CREATE POLICY residents_read ON "residents" FOR SELECT
  USING (app_is_staff() OR "id" = app_resident_id());
CREATE POLICY residents_write ON "residents" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

ALTER TABLE "stays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stays" FORCE ROW LEVEL SECURITY;
CREATE POLICY stays_read ON "stays" FOR SELECT
  USING (app_is_staff() OR "residentId" = app_resident_id());
CREATE POLICY stays_write ON "stays" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

ALTER TABLE "emergency_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emergency_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_contacts_read ON "emergency_contacts" FOR SELECT
  USING (app_is_staff() OR "residentId" = app_resident_id());
CREATE POLICY emergency_contacts_write ON "emergency_contacts" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_read ON "documents" FOR SELECT
  USING (app_is_staff() OR "residentId" = app_resident_id());
CREATE POLICY documents_write ON "documents" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- A bed assignment belongs to a resident through its stay.
ALTER TABLE "bed_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bed_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY bed_assignments_read ON "bed_assignments" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (
      SELECT 1 FROM "stays" s
       WHERE s."id" = "bed_assignments"."stayId"
         AND s."residentId" = app_resident_id()
    )
  );
CREATE POLICY bed_assignments_write ON "bed_assignments" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());
