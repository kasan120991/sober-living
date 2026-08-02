# SoberLife

Operations management app for a sober living facility. Replaces the paper binders,
whiteboards, and group texts that a house currently runs on.

**Status:** Greenfield. No code written yet. Nothing in this file is implemented unless
a section says so.

---

## What we are building toward

A single system where staff run the day-to-day of the house and residents handle their
own requests. The core loop: a resident occupies a bed, follows a schedule, and
generates a stream of compliance events (apartment checks, drug screens, meds, service hours,
sign-outs, passes). Staff need to record those events fast, and later prove they
happened.

Two design pressures shape everything:

1. **Speed at the point of entry.** A tech doing med pass or an apartment sweep is standing in
   a hallway with a phone. If logging one resident takes more than a few taps, it gets
   written on paper and never entered.
2. **Defensibility after the fact.** Every record is potentially evidence — for a
   licensing audit, a probation officer, an insurance question, or a wrongful-discharge
   dispute. Records are append-only in spirit: corrections are new entries with a
   reason, never silent overwrites.

---

## Domain glossary

Use these terms in code, schema, and UI. Do not invent synonyms.

| Term | Meaning |
|---|---|
| **Apartment** | The physical unit. A facility runs several. Serves exactly **one cohort** — this is how men and women stay housed separately. `Apartment` in code; there is no "house" or "property" entity. |
| **Cohort** | The housing and scheduling track: `MEN` or `WOMEN`. Distinct from gender identity, which is a separate concern with separate disclosure rules. Never overload the two. |
| **Bed** | The unit of capacity. Lives directly in an Apartment — there is no room level. Beds are assigned, not apartments. |
| **Resident** | A person living in the facility. Prefer this over "client" or "patient" in UI. `Resident` in code. |
| **Program** | The track a resident is on (e.g. Phase 1 / 2 / 3). Drives privileges: curfew time, pass eligibility, required service hours. |
| **Census** | Who is in which bed right now. The single most-viewed screen, and the app's landing page. Note the sidebar links to it as **Home** — the nav says where you go, the page heading says what it is. |
| **Sign-out** | A resident leaving the property and returning the same day. Has an expected return time. |
| **Travel pass** | An overnight or multi-day approved absence. Requires approval; bed is held. |
| **Apartment check** | A scheduled or random inspection of an apartment. Produces a pass/fail with findings. |
| **Maintenance request** | Work needed on an **apartment** — never a bed. Has a reporter, a priority and a lifecycle; closing one requires a note saying what was done. Whether a specific bed is usable is a separate fact on the bed itself. |
| **Stay** | One episode of residency, intake → discharge. A resident who returns gets a new Stay; the Resident record is the person and persists across both. |
| **UA / drug screen** | A urinalysis or other test. Has a result, a collection witness, and chain-of-custody notes. |
| **Med pass** | The scheduled window in which staff observe residents taking their own medication. |
| **Community service** | Hours a resident owes and works off. Tracked against a target. |
| **Intake / Discharge** | Entering and leaving the program. Discharge has a type (successful, AMA, administrative). |

---

## Core modules

Rough build order. Each is roughly one vertical slice.

### 1. Residents & intake
Profile, emergency contacts, referral source, program/phase, intake date, expected
discharge. Documents (agreements, IDs). Discharge with type and reason.

### 2. Beds & census
Apartment → Bed. Assign, transfer, hold, mark out-of-service. The census view is the app's
home screen for staff. Bed history is permanent — we must always be able to answer "who
slept in bed 12B on March 12."

### 3. Gendered scheduling
**The facility runs separate schedules for the two cohorts.** This is a hard constraint,
not a filter — it affects apartment assignment, group times, meeting schedules, and which
staff can perform certain checks and screen observations.

Cohort segregation is structural at both levels:

- **Housing:** an apartment serves one cohort, and `Stay` uses composite foreign keys so
  Postgres itself rejects a resident placed in a mismatched apartment.
- **Scheduling:** cohort lives on the event *occurrence*, not the event. Some events are
  attended by both cohorts, usually at different times — so an event has one row per
  attending cohort, each with its own start time. There is no nullable `cohort` column
  that silently means "everyone."

Any resident-facing schedule query is a join through the resident's cohort. Never render a
combined schedule by accident.

### 4. Apartment checks
Scheduled and random. Checklist-driven with per-item pass/fail plus notes and photos.
Records who inspected, when, and which residents were present. Failures should be able
to open a follow-up item.

### 5. Drug screening
Randomized and for-cause selection. Records test type, collection time, observing staff,
result, and confirmation status if sent to a lab. Refusals and dilutes are distinct
outcomes, not just "fail." Chain of custody matters — capture it.

### 6. Medication administration
Self-administration observed by staff (typical for sober living; **confirm the facility's
actual model before building** — a clinical MAR is a different and much heavier thing).
Per-resident med list, scheduled pass windows, and a log of given / refused / missed /
held with the observing staff member. Controlled-substance counts if the house stores any.

### 7. Community service
Assign an hours target per resident. Log worked hours with date, location, supervisor,
and verification. Show progress against target; flag residents falling behind.

### 8. Sign-outs
Resident requests or staff records: destination, purpose, out time, expected return.
Staff acknowledges return. Overdue returns must surface loudly on the census screen —
an unreturned resident is the highest-urgency state in the app.

### 9. Travel passes
Multi-day, approval-gated. Request → review → approve/deny with a reason. Blackout rules
by program phase. Bed is held, and the census reflects "out on pass" rather than empty.

### 10. Maintenance
**Built.** Requests raised against an apartment: title, description, priority, status.
Any staff may file one; admin and house managers close them, and closing requires a
resolution note. Deliberately independent of `Bed.status` — maintenance is a property of
the unit, out-of-service is a property of the bed, and neither drives the other.

### Likely later
Incident reports, rent/fee ledger, staff shifts and handoff notes, curfew tracking,
resident chores, visitor log, waitlist, reporting/exports for licensing and referral
sources.

---

## Users and access

| Role | Device | Needs |
|---|---|---|
| Admin / Director | Desktop | Everything. Reports, exports, config, user management. |
| House manager | Desktop + phone | Census, approvals, scheduling, all resident records for the apartments they oversee. (Job title kept as staff say it — there is no House entity.) |
| Staff / Tech | **Phone first** | Apartment checks, drug screens, med pass, sign-out returns. Fast forms, few taps. |
| Resident | Phone | Own schedule, own service hours, submit sign-out and pass requests, see status. Nothing about other residents. |

**External parties** (probation, case managers, family) are not in scope yet. When they
are, it will be scoped read-only or report-export — not an account with browse access.

Build RBAC from the first commit. Retrofitting authorization onto an app like this is
how PHI leaks happen. Residents in particular must never be able to enumerate other
residents.

---

## Compliance posture

**Treat all resident data as regulated health information.** Drug screen results,
medication records, and the mere fact that someone is in a SUD program are protected —
42 CFR Part 2 covers substance use disorder treatment records and is *stricter* than
HIPAA, notably around disclosure without written consent.

Non-negotiables, from day one:

- **Audit log** for every read and write of resident data: who, what, when, from where.
  Immutable.
- **No PHI in logs, error messages, analytics, URLs, or third-party services.** Log IDs,
  not names or results. This includes anything sent to an LLM.
- **Encryption** in transit and at rest. Encrypted DB volume at minimum.
- **RBAC enforced server-side.** Client-side hiding is presentation, never protection.
- **Soft delete + retention.** Records are retained, not destroyed, per state licensing
  requirements. Never hard-delete resident data.
- **Corrections are amendments.** Edits to a screen result, med log, or check record
  create a new versioned entry with an author and reason. The original stays.
- **Session timeouts** — shared staff devices are the norm in a house. Enforced
  server-side on the token, not by a frontend timer.
- **Tokens in httpOnly cookies, never localStorage.** Two frontends against one API means
  cross-origin auth; an XSS on the resident app must not hand over a session that can read
  PHI. Lock CORS to the two known origins.

Open: which state, and therefore which licensing body and record-retention rules apply.
Get this answered before the first production deploy.

---

## Tech stack

**JavaScript, not TypeScript.** See Conventions for how we get the safety TS would have
given us.

| Folder | What it is |
|---|---|
| `server/` | Node + Express API. **Prisma 7** over **PostgreSQL**. The only thing that touches the database. |
| `admin/` | Staff-facing app — admin, house manager, tech. Nuxt 4 + Nuxt UI v4 + Tailwind v4. |
| `client/` | Resident-facing app. Same stack. Empty until the staff side is real. |

- **Nuxt UI v4** for components, themed with our own tokens — **decided: no hand-built
  component kit.** See `design.md`, which is the source of truth for all UI work.
- **Tailwind CSS v4** for layout and one-off chrome, sharing the same `@theme` tokens.
- **Prisma 7** over **PostgreSQL**, via the `@prisma/adapter-pg` driver adapter
  (`PrismaPg`). Prisma 7 uses driver adapters — there is no `mysql2` or `pg` usage
  anywhere outside `db/client.js`.
- Auth: not yet chosen. Must support roles, server-enforced session timeout, and ideally
  MFA for admins.

### Why Prisma, and what it buys this app specifically

Beyond ergonomics, two of our hardest compliance rules stop being things people have to
remember and become structural — enforced by a Prisma **client extension** (`$extends`)
that wraps every query:

```js
const prisma = base.$extends({
  query: {
    $allModels: {
      // Soft delete: no query can accidentally return destroyed records
      async findMany({ args, query }) {
        args.where = { ...args.where, deletedAt: null }
        return query(args)
      },
      // Audit: every read and write of resident data, logged by construction
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args)
        await writeAuditEntry({ model, operation, actorId, ids: idsFrom(result) })
        return result
      },
    },
  },
})
```

This is the main reason Prisma beats raw SQL here. "Never hard-delete" and "audit every
access" applied at the client level cannot be forgotten in one route the way a hand-written
`WHERE deleted_at IS NULL` can — and the one route where it *is* forgotten is the one that
leaks.

Prisma also removes the SQL-injection surface (all queries are parameterized) and gives us
a real, replayable migration history, which matters when the schema is itself audit
evidence.

Some constraints we need cannot be expressed in `schema.prisma` — partial unique indexes
and RLS policies among them. Add those as raw SQL to the generated migration **before
applying it**. Once a migration has been applied it is immutable; corrections go in a new
migration.

### Prisma 7 differences worth knowing up front

Verified against Prisma CLI 7.9.1, not remembered:

- **`url` is gone from the `datasource` block.** Declaring it is a hard validation error
  (P1012). The migration connection string lives in `server/prisma.config.js`; the runtime
  connection reaches the client through the `@prisma/adapter-pg` driver adapter.
- **Config files may be `.js` / `.mjs`** — the loader accepts
  `['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts']`. Use `prisma.config.js` and stay in
  plain JavaScript; the `.ts` in Prisma's docs is convention, not a requirement.
- **Use the `prisma-client-js` generator, not v7's default `prisma-client`.** The v7
  default emits TypeScript source with no option to emit JavaScript — it would force a
  build step on us. The legacy generator still works in 7.9.1 and emits `.js` plus
  `.d.ts`, so editors still autocomplete every model and field.
- **`prisma.config.js` does not auto-load `.env`.** Load `dotenv` explicitly or the URL
  will be undefined.
- Run `npx prisma validate` after schema edits. It catches composite-relation and
  uniqueness mistakes without needing a live database.

The audit list is `AUDITED_MODELS` in `server/src/domain/constants.js` (renamed from
`PHI_MODELS` once facility config joined it). It covers resident data *and* Apartment, Bed
and MaintenanceRequest — changing config changes how historical records read, so an
auditor asking "why does 12D show empty in March" has an answer.

**Log IDs only in the audit extension** — never names, screen results, or med details.
Set Prisma's `log` to `['error']` in production; query logging prints parameter values,
which would put PHI in stdout.

### Why admin and client are separate apps

Not a style preference — a containment boundary. In a single app, every census view and
every staff route ships inside the bundle a *resident* downloads, and one bad route guard
is the whole breach. Two apps means the resident build has no staff code in it to expose,
regardless of frontend bugs.

The overlap is smaller than it looks: staff screens are dense tables and fast hallway
forms, resident screens are a few read-only views plus two request forms. They share
**design tokens, not code** — copy the `@theme` block into both, don't import across.

### Repo layout

```
sober-living/
  CLAUDE.md      design.md
  server/
    prisma/
      schema.prisma  # single source of truth for the data model
      migrations/    # generated by `prisma migrate`, committed, immutable once applied
    src/
      routes/        # Express routers, one per module
      middleware/    # auth, RBAC, error handling
      db/
        client.js    # PrismaClient singleton + soft-delete/audit extensions
      domain/        # shared constants (statuses, enums-as-objects)
  admin/           # Nuxt 4 app
  client/          # Nuxt 4 app — later
```

- **The frontends never touch the database.** All data access is HTTP to `server/`.
- **Authorization lives in one shared middleware**, applied per route. No route is public
  by default — routes opt out of auth explicitly, never by omission.
- **Always import the extended client from `db/client.js`, never a bare
  `new PrismaClient()`.** A bare client bypasses the soft-delete and audit extensions,
  which is exactly the failure mode they exist to prevent. `$queryRaw` deserves the same
  scrutiny, for the same reason.
- Domain constants (`SCREEN_RESULT`, `DISCHARGE_TYPE`, `MED_LOG_STATUS`) live in
  `server/src/domain/` and are copied into the frontends, not imported across folders.
  They must match the `enum` blocks in `schema.prisma`.

### Row-level security

Postgres RLS is available to us and should be used as a **database-layer backstop** on the
app's most important privacy rule: residents must never enumerate other residents.

Express middleware is still the primary enforcement. RLS is the second line — the thing
that holds when a route is added without the right guard. Belt and braces, because a
single missed check here is a 42 CFR Part 2 disclosure, not a bug report.

### Running it

```
cd server && npm run db:up && npx prisma migrate deploy && node scripts/seed.js
cd server && npm run dev      # API   → :3001
cd admin  && npm run dev      # admin → :3000
```

Dev sign-in: `admin@facility.test` / `manager@facility.test` / `tech@facility.test`,
password `soberlife-dev-1234`. Seed data only — `scripts/seed.js` refuses to run when
`NODE_ENV=production`.

Real accounts are created with `scripts/create-user.js`, which takes the password from
`USER_PASSWORD` in the environment rather than an argv flag — an argument would land in
shell history and be visible in `ps` to anyone else on the box:

```
USER_PASSWORD='...' node scripts/create-user.js \
  --email you@example.com --name "Your Name" --role ADMIN
```

It upserts, so it can be re-run to reset a password, and it **revokes that user's live
sessions** when the password changes. Note `seed.js` TRUNCATEs `users` — re-seeding
removes accounts made this way, so re-run `create-user.js` afterwards.

Two verification suites, both run against a live database:

- `npm run verify:constraints` — 20 assertions on the database-level invariants
- `node scripts/verify-auth.js` — 15 assertions on the login/session/audit flow
- `node scripts/verify-apartments.js` — 24 assertions on apartments, beds and
  maintenance, including the admin/manager field split and the rules the database
  cannot enforce

**`verify:constraints` TRUNCATEs as it runs**, so reseed before running the auth suite or
its users will be gone and every login assertion fails:

```
npm run verify:constraints && node scripts/seed.js \
  && node scripts/verify-auth.js && node scripts/seed.js \
  && node scripts/verify-apartments.js && node scripts/seed.js
```

`verify-apartments.js` creates a test apartment and leaves it behind, so finish with a
seed to get back to a clean facility.

### Auth decisions (built)

- **Server-side sessions, not JWTs.** Idle timeout must be enforced by the server and a
  session must be killable the moment a staff member is terminated or a house phone goes
  missing. A JWT needs a blocklist to do that, and a blocklist is the sessions table with
  extra steps.
- **Cookie holds an opaque random id; only its SHA-256 is stored.** A database leak yields
  no usable sessions. httpOnly, SameSite=Lax, `secure` in production, and no `Max-Age` —
  lifetime lives server-side.
- **Sliding idle expiry plus an absolute ceiling**, so an active session still cannot live
  forever.
- **One login failure message, always.** Distinguishing "no such account" from "wrong
  password" would turn the login form into a way to check whether a named person is in a
  treatment program — the exact 42 CFR Part 2 disclosure we must prevent. The route also
  verifies against a dummy hash when the user is missing, so response timing does not
  leak it either.
- **argon2id** via `@node-rs/argon2` (prebuilt binaries, no node-gyp on deploy hosts).
- **No "remember me."** Staff devices are shared.
- Account lockout after 8 failures for 15 minutes; `LOGIN` and `LOGIN_FAILED` are audited.

### Local database

There is no Homebrew and no local Postgres on this machine. Postgres runs in Docker
(Docker Desktop is installed at `/Applications/Docker.app` but does not start on login —
`open -a Docker` first, it takes ~20s).

```
cd server
npm run db:up              # postgres:17 on 5432, user/pass/db all "soberlife"
npx prisma migrate deploy
npm run verify:constraints # 20 assertions against the live database
```

`verify:constraints` is the regression test for the invariants the domain depends on —
cohort separation, no double-booked beds, immutable audit and bed history. It TRUNCATEs
as it runs, so point it only at a disposable database. Run it after any schema change.

### Environment note

Node is on **v22 LTS**. nvm's default is `22` (v22.23.2); there is also a Homebrew Node
at `/usr/local/bin/node` (v22.14.0) that non-interactive login shells pick up, since nvm
is loaded from `.zshrc` and login shells skip it. Both are Node 22, so either satisfies
Nuxt 4 — but if a version mismatch ever matters, that's the reason.

The old nvm default was v10.24.1, which could not run Nuxt 4. It is still installed but
no longer the default.

---

## Conventions

- **Plain JavaScript, ES modules.** No TypeScript, no build step on the server.
- **Domain states are frozen constant objects, never loose strings.** Without TS enums
  this is how we keep `'refused'` from silently becoming `'Refused'` in one code path:

  ```js
  export const SCREEN_RESULT = Object.freeze({
    NEGATIVE: 'negative',
    POSITIVE: 'positive',
    REFUSAL:  'refusal',
    DILUTE:   'dilute',
    PENDING:  'pending',
  })
  ```

  Declare them as `enum` blocks in `schema.prisma` so Prisma and Postgres both reject
  anything off-list. With no compiler, the schema is the type system.
- **Validate every request body at the route boundary** (Zod or similar). Nothing reaches
  a query unvalidated — this replaces what TS would have caught at compile time.
- **JSDoc on domain functions and query modules.** Enough for editor autocomplete on
  `Resident`, `Bed`, `ScreenResult` shapes without adopting TS.
- Timezone-aware timestamps stored as UTC. Curfews, passes, and med windows are
  time-critical and cross midnight — always store the facility timezone alongside
  scheduled local times.
- Mobile-first CSS for anything a tech touches in the hallway.
- Seed data should look like a real facility: several apartments across both cohorts, a
  full census, a few residents out on pass, one overdue sign-out.

---

## Open questions

Resolve these as they come up; update this file when they do.

1. Which state / licensing body? Determines retention and reporting requirements.
2. How many apartments and beds, at launch and realistically? What's the cohort split?
3. Medication model: observed self-administration only, or does staff store and dispense?
4. Does the facility already have a system (Sober Living App, BestNotes, spreadsheets)
   with data to migrate?
5. Do residents get accounts at intake, or is it staff-entry-only for phase 1?
6. Are drug screens read in-house, sent to a lab, or both?
7. Billing/rent — in scope, or handled elsewhere?
8. Where does this deploy, and does that host offer managed Postgres? Encryption at rest
   and immutable audit logs both depend on the answer.

---

## Working agreement for Claude

- Read this file at the start of every session. Update it when scope, decisions, or the
  stack change — it is the durable record, not the conversation.
- Read `design.md` before writing any component, page, or CSS. Prefer Nuxt UI components
  over custom ones; never hand-build what Nuxt UI already provides.
- Ask before inventing domain rules. Curfew times, phase privileges, and service-hour
  targets are facility policy, not defaults to guess at.
- When touching resident data, default to the conservative privacy choice.
- Prefer a working vertical slice over broad scaffolding.
