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
| **Apartment** | The physical unit. A facility runs several. Serves exactly **one cohort** — this is how men and women stay housed separately. `Apartment` in code; there is no "house" or "property" entity. Carries no timezone or address: the facility is a **single site at one address**. |
| **Cohort** | The housing and scheduling track: `MEN` or `WOMEN`. Distinct from gender identity, which is a separate concern with separate disclosure rules. Never overload the two. |
| **Bed** | The unit of capacity. Lives directly in an Apartment — there is no room level. Beds are assigned, not apartments. |
| **Resident** | A person living in the facility. Prefer this over "client" or "patient" in UI. `Resident` in code. |
| **Program** | The track a resident is on (e.g. Phase 1 / 2 / 3). Drives privileges: curfew time, pass eligibility, required service hours. |
| **Census** | Who is in which bed right now. The single most-viewed board. It lives at `/census` — it was the landing page until **2026-08-05**, when the dashboard (module 14) took `/`; the sidebar still names it **Census**, because naming the destination by the domain term is what keeps the glossary honest in the UI. |
| **Sign-out** | A resident leaving the property and returning the same day. Has an expected return time. |
| **Travel pass** | An overnight or multi-day approved absence. Requires **manager** approval; **the bed is held** and the census reads "on pass" rather than free. Eligibility is a **program** privilege — Orientation never, Phase 1 and above after 90 days. Distinct from a sign-out, which is same-day; the two are never merged and `ON_PASS` is its own status everywhere it appears. |
| **Apartment check** | One **hourly round** of an apartment: staff account for every resident who should be on site and note what each present resident is doing. Redefined by the facility 2026-08-06 — not an inspection checklist. Append-only; corrected by amendment. |
| **Maintenance request** | Work needed on an **apartment** — never a bed. Has a reporter, a priority and a lifecycle; closing one requires a note saying what was done. Whether a specific bed is usable is a separate fact on the bed itself. |
| **Stay** | One episode of residency, intake → discharge. A resident who returns gets a new Stay; the Resident record is the person and persists across both. |
| **UA / drug screen** | A urinalysis or other test. Has a result, a **collection witness** (`witnessedById` in code — module 5's prose said "observing staff" and the glossary won), a specimen id, and chain-of-custody notes. Module 6's "observing staff member" is a *different act* and stays. |
| **Med pass** | The scheduled window in which staff observe residents taking their own medication. |
| **Community service** | Hours a resident owes and works off. Tracked against a target. |
| **Intake / Discharge** | Entering and leaving the program. Discharge has a type (successful, AMA, administrative). |
| **Ledger** | A stay's fee history — rent, laundry, trips, program fees, damages, and the payments and credits against them. Append-only. |
| **Balance** | What a resident owes: `SUM(invoice totals, excluding VOID and DRAFT) − SUM(payments)`. **Derived, never stored.** Negative means they are in credit. **This REVERSES the original rule** (`SUM(charges) − SUM(payments + credits)`), changed 2026-08-07 — a charge is not owed until an invoice asks for it. See module 11 for the failure that forced it. |
| **Invoice** | A dated demand for payment, sent through Stripe, and **the thing that makes money owed**. Holds a **total** — a snapshot of what was billed the day it was sent, which must not move when a later correction lands. That immutability is load-bearing twice over since 2026-08-07: the balance is built from these totals, so a movable one would silently rewrite what a resident owes. **Voiding removes the demand** and drops the balance by exactly its total; its lines stay bound and never re-bill. Voided, never deleted. |
| **Invoice line** | The join row binding one ledger entry to one invoice. Its own table (`invoice_lines`) precisely so `ledger_entries` keeps its no-update guarantee; unique on the entry, so a charge cannot be billed twice — and a voided invoice's lines are never re-billable. |
| **Pending** | A CHARGE or CREDIT with **no row in `invoice_lines`**. A read, never a stored flag. Payments are never billable, so never pending. **Not part of the balance** — pending money is stated beside it, never folded into it. Called **Unbilled** until 2026-08-07; the word changed with the rule, in the UI *and* in the code (`pendingCents`). |
| **Draft** | An invoice whose Stripe half never finished. Its lines are bound, so they are not pending; it was never issued, so it is not owed. In **neither** figure — which is why `draftCents` is surfaced on its own, and why a keyless send now refuses rather than quietly making one. |
| **Overdue** | An OPEN invoice past its `dueAt` on a stay whose balance is still positive. **Derived**, so cash paid at the desk clears it without touching the invoice. Invoices are **net 3 days** (`INVOICE_NET_DAYS`), due at the *end* of the third facility day, and **the record's red dot is exactly this** — there is no second grace period and no `dotDue` field (both removed 2026-08-07; the term carries the grace). Note the **status pill's "overdue" means sign-outs** and always has; the two never merged. |

---

## Core modules

Rough build order. Each is roughly one vertical slice.

### 1. Residents & intake
**Built.** Roster table (search, include-discharged toggle) → full-width record page.
Intake creates the person, their stay and optionally their bed **in one transaction**.
Beds can be assigned, moved or released from the record. Discharge records a type and a
required reason, closes the stay, frees the bed, and **cannot be undone** — a mistake is
corrected by a new intake, not by editing the record.

Managers and admins intake, discharge and move beds; techs read the roster.

Intake runs in four sections — Personal, Program & Room, Contact, Insurance — clickable as
well as sequential, because facts arrive out of order with a folder open. **Only a name is
required**; everything else is added to the record later.

**SSN is the last four digits only**, never the whole number: a facility has no use for one
and holding it turns a records breach into an identity-theft breach. A CHECK constraint
refuses anything that is not exactly four digits — the failure worth catching is a full SSN
pasted into a box labelled "last 4". Read is restricted to **admin and house manager**, and
the field is *omitted from the response* for anyone else rather than hidden in the client,
so it never goes over the wire.

**Orientation is a Program at level 0**, not a separate status field — it sorts above
Phase 1 and is what intake selects by default. There is deliberately no "program type":
this facility is residential only, so a Stay always expects a bed and anyone without one is
an exception the bell should shout about.

**Resident photos are deferred with documents** — the reference intake form has a photo
upload and it is deliberately not built, for the reason below.

**Documents are deferred.** The `Document` table exists but nothing uploads yet: storing
scanned IDs and agreements needs object storage, encryption at rest, and access brokered
through the API so every read is authorised and audited. That is its own slice.

**The record page is a status rail (decided 2026-08-02**, from three rendered variants — a
tab strip and a unified compliance timeline were the others). Every module eventually shows
something about a resident, and a tab per module does not survive twelve of them: the strip
scrolls horizontally on a phone and whatever is off-screen may as well not exist. A vertical
in-page rail holds twelve without scrolling and scales past that.

The rail is grouped, and the groups are load-bearing rather than cosmetic —
**Record** (Overview, Schedule, Sign-outs, Travel passes, Apartment checks), **Clinical**
(Drug screens, Medications), **Administrative** (Community service, Ledger, Contacts, Stay
history, Documents). Grouping is what lets a policy apply to a whole class of module at once
instead of being re-decided per tab.

- **The rail is a status board, not navigation.** Each section can carry a dot, so where
  attention is needed reads before anything is opened. **Amber is behind on service hours;
  red is the record's loudest fact** — red was reserved for balance-overdue when the
  palette was chosen (2026-08-02) and was **redefined 2026-08-06** when apartment checks
  gave the record something louder than money to say. **Amber is live since module 7**
  (20 hours a month, accruing in whole months from intake and capped at the target — see
  module 7). **Red is live since module 4's record section**, meaning *unaccounted for*:
  the last apartment check could not find them and nothing has accounted for them since —
  derived on `GET /residents/:id` by the same `services/checks.js` helper the bell's
  RESIDENT_NOT_ACCOUNTED item uses, one knob, so the record and the bell cannot disagree.
  **Balance-overdue HAS joined red** (2026-08-06), now that invoicing gives a charge a due
  date — `dots.ledger`, derived through `stayInvoiceSummary()` in services/invoices.js, the
  same helper the dashboard reads. It keys on **`overdue`** — plainly, since 2026-08-07.
  It used to key on a separate `dotDue`, because invoices were due on receipt and were
  therefore past due the morning after they were sent, so the dot needed seven days of its
  own grace to avoid lighting on nearly everyone. Net-3 terms replaced that: the invoice
  itself now carries the grace, and one fact has one name again. A resident can carry
  **two red dots at once** — unaccounted-for and overdue — and the rail renders one per
  section, which is right; where anything ever needs a single answer, **unaccounted-for
  outranks overdue**, because one is a person nobody can find and the other is money. A
  section with nothing wrong shows no dot, the same rule
  the census tiles follow: absence of a chip means fine, which keeps a quiet record quiet.
- **Techs see the Clinical group** (decided 2026-08-02). This does not contradict the bell
  rule under module 13 — that one is about *ambient* disclosure, a name against a screen
  result surfacing unbidden on a phone with residents nearby. Opening a named resident's
  record is a deliberate navigation by someone who already knows who they are looking at,
  and the audit log records it. The two are different acts and get different answers.
  **Module 5 made that justification load-bearing**: because "the audit log records it" is
  the whole argument, screen results are never bulk-shipped to a page — revealing one
  fetches it by id, so the log can actually answer *who looked at whose result*. A
  Clinical section carries **no dot**, for the same reason.
- **Overview is "needs attention" over recent activity** — the flagged items with their
  action, then the last few events across all sections. It is the one place the modules
  interleave in time, because "what has been going on with this person" is the question a
  staff meeting, a discharge review and a probation officer all actually ask, and no
  per-section view answers it.
- **This is in-page navigation, not app navigation.** It is not the second-level sidebar
  menu rejected under UI rules: these sections are real and already named, not IA invented
  to fill a template shape. Below `md` the rail collapses to a sheet.
- Sections whose module is unbuilt render `AppStub`, so the rail is never a dead end.

Still open: whether the record shows the **current stay or all stays**. Ledger entries and
sign-outs hang off `Stay`, so a returning resident's history belongs to separate episodes —
a stay switcher in the rail is cheap now and awkward to retrofit.

### 2. Beds & census
**Built.** Apartment → Bed. Assign, transfer and out-of-service live under Apartments and
the resident record; the census board lives at `/census` (the landing page is the
dashboard since 2026-08-05 — see module 14) — one `GET /census` read
returning figures, apartments with bed tiles, and whoever is awaiting a bed. Bed history
is permanent — we must always be able to answer "who slept in bed 12B on March 12."

**Apartment names are typed as just the number** — the create and edit dialogs show a
fixed "Apt" prefix and compose the full name (`utils/apartments.js` in the admin app), so
"12", "apt 12" and "Apt 12" all land as "Apt 12". The API and database still carry the
full name; the convention is a form-level one.

**Removing an apartment is soft, and admins can undo it.** `GET /apartments/removed` and
`POST /apartments/:id/restore` (both admin-only) back a "Removed" section at the bottom of
the apartment list; restore brings back the apartment *and every bed it held*, statuses
and out-of-service notes intact — removal requires removing the beds first, so their
deletions are part of the same act being undone. Because `Apartment.name` is uniquely
indexed across removed rows too, creating an apartment whose name a removed one holds is
refused with a message that points at restore. This rides on a deliberate rule in the
soft-delete extension (`db/client.js`): the `deletedAt: null` filter is added only when a
query says nothing about `deletedAt`, so reaching removed rows takes an explicit clause —
still through the extended client, so the read is audited and RLS'd like any other.

The board is the **bed-tile layout (variant A of the census mocks)**, chosen over a table
because the screen replaces a whiteboard and a whiteboard's virtue is that absence is
visible: a free bed and an out-of-service hole read at a glance. Three tile states —
occupied (name, program, since), free, out of service with its note. Staff-only, never
`RESIDENT`: the census is every housed resident by name.

**Presence chips are live** now that sign-outs exist: a warning "Out · back 5:30 PM"
chip, a destructive "Overdue 2h 41m" chip with a red-striped tile, and deliberately no
chip when in house — absence of a chip means present, which keeps a quiet board quiet.
The figures row counts signed-out and overdue (hidden at zero), re-derived client-side
against the page's 30-second tick.

**The "on pass" chip arrived with module 9 (2026-08-08), and the bed hold with it —
which cost nothing, because a pass never touches `bed_assignments` at all.** An on-pass
tile keeps its name and its occupied styling and gains a **muted** chip carrying a
**date** ("On pass · back Sun 10 Aug"), not a clock time: a pass spans days, and "back
5:30 PM" on a Thursday pass reads as today. Late reads "Overdue back 2h 41m" in
destructive with the inset. `onPass` and `passOverdue` are counted **beside** `occupied`
rather than instead of it — that is the hold made visible, and it is what stops the board
reading as though a bed came free. The tile still carries **no destination**, on any of
the states. If the facility outgrows a screenful of tiles, the fallback is the table
variant; the figures row carries over unchanged.

**A free tile is the placement affordance** (built 2026-08-02). `unhoused` had been in the
census response since the start and rendered nowhere; the tile is what uses it. A free bed
becomes a *button* exactly when someone of that cohort is waiting — so clickability itself
says where a waiting resident can go, and there is still no unhoused list on the page. With
nobody waiting the tile stays an inert `div`: an affordance that can only open a dialog
saying "nobody to assign" is dead weight on the most-glanced screen. Techs see the board and
never the affordance; `managers` on the endpoint is the real boundary, asserted in
`verify-residents.js`.

The tile carries no name — candidates appear only after a deliberate click, inside the
dialog. Same reason the tile never carries a sign-out destination: this board is read over
somebody's shoulder.

Two things that make this safe, both worth keeping if it is ever touched:

- **`POST /residents/:id/bed` is assign-OR-move**, not assign-only — it closes whatever
  assignment the stay holds. So a stale candidate list turns "assign someone unhoused" into
  "move someone housed", writing a spurious ended/started pair into bed history, which is
  permanent evidence. Guarded twice: the page's `candidates` is a **computed** over live
  census data so it shrinks the moment the socket lands, and the dialog watches it and drops
  a selection that stops being unhoused. Do *not* make the endpoint refuse a resident who
  already has a bed — the roster's Move bed depends on that behaviour.
- **`assignBedTo` now answers a cohort mismatch with a 409** instead of letting the
  composite FK surface as a raw Prisma error and a 500. The foreign keys are still the
  enforcement; this is only their friendly face, and bed-first assignment is what made a
  swapped pair of arguments reachable. Note the old assertion for this was `>= 400` and was
  passing on `400 Invalid bedId` because the suite had no free MEN bed to test with — so
  cohort enforcement through the API had never actually been covered. It is now (46
  assertions).

### 3. Gendered scheduling
**The facility runs separate schedules for the two cohorts.** This is a hard constraint,
not a filter — it affects apartment assignment, group times, meeting schedules, and which
staff can perform certain checks and screen observations.

Cohort segregation is structural at both levels:

- **Housing:** an apartment serves one cohort, and `Stay` uses composite foreign keys so
  Postgres itself rejects a resident placed in a mismatched apartment.
- **Scheduling:** cohort lives on the event *occurrence*, not the event. An event is
  created for the men, the women, or **both**, and it has **one time** — entered once,
  never per cohort. A both-cohorts event is still stored as one occurrence *per cohort*
  with identical timing, because that is what keeps the composite foreign keys able to
  refuse a woman on a men's occurrence. That split is a **storage detail and is invisible
  in the UI**: one set of fields, one roster, one card on the board, one roll. There is no
  nullable `cohort` column that silently means "everyone" — "everyone" is two rows, asked
  for explicitly, never a null.

Any resident-facing schedule query is a join through the resident's cohort. Never render a
combined schedule by accident.

**Attendance is explicit rows, not "everyone in the cohort" (decided 2026-08-02).** Cohort
decides *which occurrence* an event has and when it starts; it does not decide who is on it.
Creating an event picks a cohort and then picks attendees from that cohort's residents, so a
group of six and a house-wide meeting are the same shape with different lists.

Two consequences worth stating, because the cheaper design forecloses both:

- **A resident's schedule is a join through attendance, not through cohort.** "What is
  Marcus doing tomorrow" reads his attendee rows — it never derives a schedule from the fact
  that he is a man. Cohort remains the segregation constraint; attendance is the roster.
- Attendance rows are what later carry per-resident facts an event needs — attended, absent,
  excused. A cohort-derived schedule has nowhere to put those, which is the retrofit to
  avoid.

This is the resident record's **Attendance** section (see module 1) and it is read-only
there: the record answers what HAPPENED, and the event itself is created, edited and rolled
from the schedule module. That split is what stops twelve rail sections each growing an editor.

**It was called Schedule and carried a 14-day diary until 2026-08-08.** The facility removed
the diary and renamed the section, and the rename is the honest half of that rather than a
relabel: with no diary, "what is this person scheduled for" is not a question this section
answers at all — `/schedule` owns the events and answers it. The old name would have gone on
promising something that had been taken out. Confirmed at the same time: the upcoming view
does **not** move elsewhere on the record.

Three things went with it, and each was load-bearing while it lasted, so they are recorded
rather than deleted: the FullCalendar **list view** and its 14-day custom duration; the
`height: 420` that kept three bands visible together; and the day-header `level` branch, whose
lesson — a list day header has TWO cells and a content generator replaces the text of BOTH —
is recorded **here and nowhere else in code** as of 2026-08-08: it lived on in
`AppTodaySchedule.vue`, and that component stopped being a FullCalendar view the same day.
The lesson still holds for any list view the board grows. The board keeps its own list view;
only the record's copy is gone.

**The section is a counts band over a day-grouped trail** (variant A, chosen 2026-08-08 from
three rendered variants; a per-group breakdown and an eight-week grid were the others). It is
the same shape as Apartment checks and Medications, so the rail reads consistently the whole
way down — and a record section is usually opened by somebody who came for a different reason.
What it gives up, knowingly: it shows a **list, not a shape**, so three absences in a row and
three across a month look alike until you read the dates. The grid variant is the fallback if
the house ever wants the pattern, though attendance here is a few sessions a week and too
sparse for a grid to earn its space.

**`GET /residents/:id/attendance` covers the WHOLE STAY, keyset-paginated** — renamed from
`/schedule`, which answered a question the endpoint no longer asks. Dropping `upcoming` removed
this read's only use of `expand()`, `materializedByKey()` and the window; what is left is a
straight paginated read over `schedule_attendance`, cursored on `(sessionDate, id)` exactly
like `residentChecks()` and `residentMeds()`. The old `?s=schedule` section key is aliased to
`attendance` in `residentSections.js`, because the key is in the URL and a link somebody saved
outlives the rename — without the alias it falls through to Overview, which looks like the
link worked while showing the wrong thing.

**THE SUMMARY COUNTS THE STAY, NOT THE PAGE**, and it is computed on the server for exactly
that reason. `attendanceSummary()` derived its counts from the ten rows it had been sent, which
was true while ten rows were all there were; against a paginated history the same arithmetic
describes page one under a heading claiming to describe the stay — a figure that shrinks as
somebody scrolls. It is a `groupBy` over the stay, it rides on page one only, and `since` is
the oldest session date rather than the oldest loaded one. There are assertions for the total
exceeding a loaded page and for a cursor page omitting the summary.

**Marks are ordered by the SESSION's date, not `createdAt`.** It was "the most recently *typed*
marks", which is a different list the moment anybody back-fills a roll — and the section reads
it as a chronology. The tiebreak is the **id**, not `createdAt`, so the keyset is total: two
marks sharing a date still have a stable order, which is what stops a page boundary repeating
or skipping a row. There is an assertion pinning the order.

**Two fields had always been on the wire and dropped.** `hasActiveStay` is why a discharged
resident used to be told "nothing scheduled in the next two weeks" — which reads as a rota gap
and sends somebody hunting for events that ought to be there. There are still **three** empty
states: no active stay, an active resident with nothing recorded, and a stay whose marks have
not started yet.

**Attendance reads as counts, never a percentage** — `attendanceSummary()` in
`utils/schedule.js`. `recent` caps at ten and a new resident has one or two marks, so "1 of 2"
carries its own sample size where "50%" would imply a measurement; it is the same "N of M" habit
as verified-of-required hours and marked-of-roster. The summary and the bar are **hidden
entirely** when nothing has been recorded — a 0-of-0 bar reads as a failing grade rather than as
an absence of information. The bar is the `h-2` flex track from `AppServiceProgress` /
`AppCohortCapacity`, deliberately not shadcn's `Progress`.

**`attendanceDisplay()` sits beside `sessionStateDisplay()`**, not folded into it: a session is
scheduled, cancelled, taken or missed; a person attended, was absent or was excused. They share
only the tone scale, which is why they share `toneClass` — and `toneClass` gained a
`destructive` branch for ABSENT, used nowhere on the board because red there would compete with
`--warning` meaning "roll due".

**Built.** Five tables — `ScheduleEvent` (identity only), `ScheduleOccurrence` (cohort +
when, one row per attending cohort), `ScheduleSession` (a dated instance),
`ScheduleAttendee` (the roster) and `ScheduleAttendance` (the mark). Recurring and one-off
are the same shape with a different rule.

Four decisions do the work, and each has a cheaper alternative that fails:

- **The roster and the mark are separate tables at separate levels.** This *revises the
  sentence above* — that bullet was written before recurrence was decided and reads as
  though one table carries both. It cannot. A weekly group of eight over twelve weeks would
  need 96 roster rows up front, or one roster row carrying a status overwritten every week,
  which destroys last week's record in an app whose whole posture is that records are
  evidence. The roster hangs off the **occurrence**, the mark off the **dated session**. The
  rule that falls out, and which is in the schema verbatim:

  > **Before attendance is taken, a session's list is the live roster. Once taken, it is the
  > marks.**

- **Sessions are computed on read and materialized LAZILY.** A `ScheduleSession` row exists
  only because something date-specific was recorded — a roll taken, a date cancelled, a time
  moved. Everything else is expanded from the rule at read time. Generating rows ahead of a
  horizon needs the cron job this app is proud of not having, plus a backfill and a
  regeneration story when a rule changes. `services/schedule/expand.js` is **pure and must
  stay the only expander** — two of them is how the board and the resident record come to
  disagree about whether Tuesday exists, and there is an assertion for it.

- **A recurring time is stored as a wall-clock string, not an instant.** `startsAtLocal` is
  `'HH:MM'` and is converted per date by `facilityWallClockToUtc()`. A weekly 6pm is 6pm on
  both sides of a DST boundary; an instant drifts an hour in November. This is the one place
  in the app that deliberately does not store UTC — precedent is `Program.curfewLocalTime`.
  Duration is minutes, not an end time, because an end time that wraps midnight is a bug
  factory.

- **`GET /schedule` returns LANES PLUS A SHARED BAND, never a flat list** —
  `{ shared, lanes: [MEN, WOMEN] }`, both lanes always present in that order even when
  empty. **A both-cohorts event appears in `shared` and in NEITHER lane**, so nothing
  renders twice. The accidental merge is still impossible: what sits in a lane is
  single-cohort by construction, and what spans both was certified by the server from a
  cohort choice a manager made deliberately. There is an assertion that a shared event is
  absent from both lanes — an implementation that emits the band *and* leaves the rows in
  the lanes otherwise passes everything while double-drawing the whole board.
- **A shared session is TAKEN only by unanimity, and MISSED on a single gap.** Cancelled
  when every underlying session is cancelled; taken only when every occurrence running that
  date carries `attendanceTakenAt`; missed otherwise once it is past. `rosterCount` and
  `markedCount` are sums, and cannot double-count because a stay has exactly one cohort and
  the composite foreign keys enforce it. The failure directions decide this: unanimity can
  leave a roll in the queue somebody already half-took, which one tap fixes; the alternative
  leaves half the house with no attendance record while every screen says the roll is done,
  which is the evidence loss this module exists to prevent.

Consequences worth knowing before touching it:

- **The roster references `stayId`, not `residentId`** — like sign-outs and the ledger. On
  discharge the stay closes and the person drops off every future session **with no write at
  all**. Materializing ahead loses exactly this: you would have to delete future rows on
  discharge, and forgetting once puts a discharged resident on next week's list.
- **A future session has no row, so its address is `(eventId, date)`** and no session id ever
  crosses the wire. It was `(occurrenceId, date)` until both-cohort events needed one roll
  across two occurrences. Because an event's occurrences share one rule they share one set of
  dates, so the event-level pair is unambiguous: it is a **fan-out address** resolving to
  every live occurrence that runs on that date — one for a single-cohort event, two for a
  both-cohorts one, and one again past one side's `endsOn`. `takeAttendance` routes each mark
  to the session of the occurrence matching that stay's own cohort, materializes **every**
  session involved and stamps `attendanceTakenAt` on all of them, in one `runInTransaction`.
  `materializeSession()` still refuses a date the recurrence does not cover, using the same
  `occursOn()` the expander uses — otherwise a caller could conjure a phantom Sunday session
  for a Tuesday group.
- A both-cohorts event with an **empty roster on one side** still gets that side's session
  created and stamped. That is not a violation of "a row exists only because something was
  recorded" — the stamp **is** the record: it says the roll was taken and nobody was on that
  side, which is true, and it is what stops that side sitting in the queue forever.
- **Setting the schedule is manager-only; TAKING THE ROLL IS ALL-STAFF.** Identical reasoning
  to sign-outs: the person running the group is the one holding the phone, and making them
  find a manager is how attendance ends up on paper. Cancelling a session stays with managers
  — a cancelled session is what an auditor reads as "the meeting did not happen."
- **A mark is corrected by changing its status, not by an amendment.** Attendance is not a
  lab result, and making a tech file paperwork to fix a mis-tap in a hallway is the friction
  this module exists to remove. The audit extension already records who changed what.
- **An event with any attendance recorded cannot be deleted**, only ended (`endsOn`).
  Soft-deleting it would make the soft-delete extension filter it out of every resident
  record and silently erase attendance history. Same shape as the sign-outs rule: fixable in
  error, but only while nothing has been recorded.
- `ScheduleSession` and `ScheduleAttendance` are deliberately **absent from
  `SOFT_DELETE_MODELS`**, and that is not an oversight to tidy up.

**The board is a roll queue over a FullCalendar grid, in three views — Day, Week, Month**
(restructured 2026-08-05). The **un-taken roll queue** sits above, looking *backwards* two
weeks independently of the window shown, because a roll nobody took is what quietly costs the
facility its evidence. It is derived on every read, so it clears itself the moment a roll is
taken — the same reasoning as the bell having no Notification table.

**The hand-built day agenda and two-lane week table were retired** (2026-08-05). Both were
chosen from rendered variants on 2026-08-03; both are gone, and their ~250 lines of markup
with them, including four near-identical copies of the session tile. Day and Week are now
FullCalendar views in **one merged column**, and what used to be the FullCalendar "Calendar"
entry is Month.

What that trades away, stated because it is a real loss and not a refactor: **the cohort
split is no longer visible as geometry**. There is no lane and no shared band on screen. It
now reads as the **word on the tile** — "Men", "Women", "Both" — plus an All/Men/Women
filter. Choosing "Men" shows men-only events *and* shared ones, because a shared event *is*
on the men's schedule; a "Both only" option would be a report, not a filter.

**The server contract did not move, and that is what makes this safe.** `GET /schedule` still
returns `{ shared, lanes }`, `band.js` still merges a both-cohorts event exactly once, and
all **61 assertions in `verify-schedule.js` pass unchanged** — that unchanged suite is the
evidence the restructure stayed client-side. The client concatenates two arrays the server has
already certified disjoint; there is still no flat list on the wire and there must never be a
server endpoint returning one.

Cohorts are distinguished on screen by **label and rule, never by hue** — that rule survives
intact, and matters more now that it is the only cohort signal. **No resident names on the
board**: counts on the tiles, names only inside a roll somebody deliberately opened, the same
rule as the census tile.

**The board's clock tick REFETCHES, at 60s — not the census's 30s re-derive.** A session
crossing into MISSED is no write, so no socket event tells the page; that is the same class of
problem as a sign-out going overdue (module 8). The difference is that presence is derived
client-side and free, whereas session state is computed on the server, so this one has to ask.
Hence 60 seconds rather than 30: noticing a missed roll a minute late costs nothing, and an
HTTP request every 30 seconds on a shared house phone is not free. Note the tick that was here
before **did nothing** — it set a `now` ref no template read — so a session going missed never
surfaced until something else happened to refetch.

**Different times per cohort was built and then dropped (2026-08-04).** The occurrence was
allowed its own start time, so "Morning Reflection at 7:00 for the men and 7:30 for the
women" was one event. It bought one real case and cost a create form with two of every
field, a board that drew a house meeting twice, and two rolls for one meeting. Under the new
rule a genuinely staggered pair is **two events**, which is what it always was operationally
— two meetings in the same room half an hour apart. The seed says so, deliberately, because
the seed is where anyone looks to learn how the model wants to be used.

The one thing this loses: identical timing across an event's occurrences is an invariant
**nothing in the database enforces**. The read layer refuses to merge a pair whose times
disagree — it leaves them in their two lanes on the wire, and since the lanes were retired
from the board that now surfaces as **two separate tiles** — rather than render one card that
lies about when the meeting is. The cohort segment in the calendar event id is what keeps
those two tiles independent; without it FullCalendar would treat them as one event and drag
them together, which is the very lie this fallback exists to prevent.

### FullCalendar 7, on the `pulse` theme

Upgraded from 6.1.21 on **2026-08-05**, to get the `pulse` flavour the facility asked for.
Pulse exists only in v7, so this was a migration rather than a re-skin.

- **v7 RE-HOMED the view plugins into the adapter package.** They are subpath exports now:
  `@fullcalendar/vue3/daygrid`, `/timegrid`, `/interaction`, `/list`, `/multimonth`. This
  **corrects an earlier note here** that said "no view plugin has a stable v7" — the
  observation was right (`@fullcalendar/daygrid` still stops at 6.1.21) and the conclusion was
  wrong. They moved. Dependency count went *down*: four packages became **one**,
  `@fullcalendar/vue3`, pinned exact at **7.0.2** because the palette below depends on
  `--fc-pulse-*` names that ship with it. Plus `temporal-polyfill`, a declared peer that is
  **not** marked optional.
- **Premium is still out.** Every resource and timeline plugin is Premium and its evaluation
  licence is Creative Commons **NonCommercial**, which does not cover a facility charging rent.
  That is why cohorts are a **word plus a filter** rather than resource columns.
- **The shadcn `pulse` block at fullcalendar.io/docs/shadcn is REACT-ONLY** — all ten registry
  items ship `.tsx` against `@fullcalendar/react`, and there is no Vue variant (the registry
  404s for one). Do not try to consume it. `@fullcalendar/vue3/themes/pulse` **is** that same
  design, precompiled, and it is what we import.
- **Pulse is driven by 31 `--fc-pulse-*` custom properties, and a "palette" is just a CSS file
  setting them.** `assets/css/fullcalendar.css` is now ours, mapping all of them to **bare
  tokens** (`var(--primary)`, never `var(--color-primary)` — the `@theme inline` names resolve
  at build time and are not theme-reactive). The shipped palettes are hardcoded hexes and would
  discard the preset's teal. **There is no `.dark` block and there must not be one**: every
  value inverts already, including the neutral overlays, because they are
  `color-mix(… var(--foreground) …)` rather than fixed black/white alphas.
- **v7 MINIFIES its internal class names** (`.fc-dl`, `.fc-ei`, `.fc-oh`). Every v6 selector
  the old CSS used — `.fc-timegrid-slot`, `.fc-col-header-cell-cushion`, `.fc-event-main`,
  `.fc-daygrid-day-number` — is gone, and nothing written against a hashed class would survive
  a patch bump. **Style through the `*Class` OPTIONS instead** (there are 72 of them), which
  apply classes we choose. The 44px tap floor went the same way: it is **`slotMinHeight`**, an
  option gated on `useMediaQuery('(max-width: 767px), (pointer: coarse)')`, not a height
  override. Measured: a 30-minute tile is 44px on a phone.
- **CSS is now real stylesheets, not injected from JS** — the reverse of v6, and it changes
  where they are registered. `nuxt.config.js` `css:` order is load-bearing: `main.css`,
  `skeleton.css`, `themes/pulse/theme.css`, then **our palette last**. Both FullCalendar sheets
  are still unlayered, so they still beat Tailwind's layered rules.
- **`eventContent` emits BARE CHILDREN, never a wrapper of our own.** Pulse's
  `columnEventInnerClass` already sets the flex direction — row when the tile is short, column
  when there is room — so a wrapper imposing `flex-col` fights it and clips a 30-minute tile.
  Use `arg.timeClass` / `arg.titleClass`, which are pulse's own computed classes.
- **A one-row tile drops the state marker and keeps the cohort word.** `isShort` catches a
  short block tile; a **month cell** is one row however long the session is, so `isCompact()`
  checks `view.type === 'dayGridMonth'` too. Checking only `isShort` left month cells rendering
  `"M…"` where the title should be. The full line lives in the tile's `title` attribute, set
  from `eventDidMount`.
- **`headerToolbar: false`** (v7's default anyway). `AppScheduleToolbar.vue` is pulse's own
  toolbar ported to Vue: vendored `Tabs` for the view switch, ghost icon `Button`s for
  prev/next, driven by **`useCalendarController()`**. Two traps in that controller — it is a
  Proxy over a revision ref, so *reading* a property subscribes to it and no watcher is needed;
  but `getButtonState()` proxies an **empty object**, so it must be indexed
  (`buttons.prev.isDisabled`) and **never key-iterated** — `Object.keys()` returns `[]`.
  The title comes from `controller.view.title`, so the label cannot disagree with the grid.
- **Renamed in v7:** `eventClassNames` → `eventClass`, `slotLabelFormat` → `slotHeaderFormat`,
  `slotLabelInterval` → `slotHeaderInterval`. `--fc-*` variables were refactored away entirely.
- **FullCalendar is fed NAIVE WALL-CLOCK STRINGS** (`2026-08-11T19:00`, no `Z`), never a
  session's `startsAt`. **v7 CAN take `timeZone: 'America/New_York'` natively** — that is new,
  and we deliberately decline it. With naive strings a dropped Date's *local* fields already
  are the facility wall clock, which is exactly what `localDateKeyOf()` reads; a named zone
  turns the drag readback into an instant needing `formatDate()` or Temporal, on the one path
  that writes to the database, and adds a **sixth** place in the repo naming the zone where
  five are tracked on purpose. **Passing `startsAt` would render in the browser's zone** and is
  the one change that would make this screen disagree with every other screen.
- `utils/facilityTime.js` has **`localDateKeyOf()`**, which reads a Date's local fields with no
  conversion. It is deliberately **not** `facilityDateOf()` — that re-interprets an instant in
  New York, which is right for the wire and wrong for a Date FullCalendar built from our own
  naive string.
- Named **`FcCalendar`**, not `Calendar`: shadcn ships a `Calendar` date picker and `ui/` is
  registered with `pathPrefix: false`.
- **A calendar event id carries a cohort segment** (`eventId|date|MEN+WOMEN`). Without it, the
  refuse-to-merge fallback's two lane rows share an id, and FullCalendar drags them as one —
  reintroducing exactly the lie that fallback exists to prevent.
- The flat event array is a **deliberate concatenation of two provably disjoint bands**, done
  client-side. There is still no flat list on the wire, and there must never be a server
  endpoint returning one — that is what a resident-facing read would reach for.

**Colour on the board changed, and it is a deliberate reversal (2026-08-05).** Tiles are now
**solid `--primary` for every session**, which is the pulse look the facility chose; state
reads as a **marker inside the tile** — nothing for scheduled, `✓ 3/3` for taken, `! Roll due`
for missed. The older rule on this screen was "a scheduled session is quiet, colour means
state", and this overrides it.

Two things moved with it and must not be undone independently:

- **The roll queue is now load-bearing, not a convenience.** When every tile reads equally
  loud, "needs attention" cannot be found by glancing at the grid — the band above is where
  that signal lives. Do not remove it without putting the signal somewhere else first.
- **The now-indicator is `var(--foreground)`, not `--primary`.** A teal line over teal tiles is
  invisible; that is the direct cost of solid tiles. It is a locator, not a state, so it gets a
  strong neutral. Red stays reserved for `--destructive`, and `--warning` already means "roll
  due" on this very screen.
- **CANCELLED is the one exception to solid tiles** — muted fill and a struck-through title via
  `sl-cancelled`, because an auditor reads a cancelled session as "the meeting did not happen",
  which is a different claim from "it happened, here is the roll".
- Cohort is **still never a hue**. That rule did not change and now carries more weight.

**One state→appearance mapping, `sessionStateDisplay()` in `utils/schedule.js`.** There were
three — a dead `stateTone()`, `stateChip`/`chipClass` inlined in the page, and `stateClass()`
in the calendar. Three copies is how the queue band and the tiles come to disagree about what
"taken" looks like.

**Month renders list-items, not solid blocks.** That is pulse's own treatment for a month grid
and it is kept: 100+ solid teal rows would be unreadable. Worth knowing before someone
"fixes" it.

**Per-date reschedule is built** — dragging a tile moves **one date, never the series**. The
user dragged one tile and a tile is one date; rewriting every future Tuesday because somebody
nudged next week is the direct-manipulation betrayal, and there is no undo stack. Changing
the series is `startsAtLocal` on the occurrence, which is editing the event: a form, not a
gesture, still deferred.

- `POST /schedule/reschedule`, **managers only**. A roll is an observation by whoever was in
  the room; a reschedule is a **decision**, and its closest analogue — per-date cancel — sits
  with managers for the same reason.
- It **fans out to every running occurrence** in one transaction, including a side that
  happens to be cancelled. Writing one side and not the other makes a shared card lie about
  when the meeting starts — and `band.js` catches it by *refusing to merge*, splitting one
  card into two. That split is the visible symptom and the assertion.
- Refused for a date the recurrence does not cover, a past session, one whose roll has been
  taken, and a cancelled one. **Only a SCHEDULED session that has not yet ended can move** —
  in-progress counts, because "we are running twenty minutes late" is the case this is for.
- **A cross-day drag never reaches the server**: `eventAllow` compares date keys and refuses
  the drop, so the tile springs back with no request and no error. Nothing tells the user
  off, because nothing went wrong.
- `startsAtLocal: null` clears the override. `eventResize` is off — there is no per-date
  duration column, so a resize would be a series change wearing a gesture.

**Creating an event is a wide two-column dialog above `md`, the same form as a page below it**
(chosen 2026-08-05 from three rendered variants). The roster sits in the right column, and
**the cohort switch heads that column rather than living with the event fields** — it is the
only control on the form whose effect is another control's *contents*, so putting it anywhere
else means switching Men → Both refills a list on the far side of the dialog with nothing
connecting cause to effect. Both rejected variants left it on the left.

- The right column also gains a **search field**, which stops being decoration the first time
  the house has thirty active residents. Searching narrows **what is shown, never what is
  selected** — tick somebody while filtered, clear the box, and they stay on. The "N of M
  selected" denominator counts the **full** candidate list, because the roster's size is a
  fact about the event and must not appear to shrink because somebody typed. Select-all acts
  on what is shown and says so ("Select these 3"), since over a filtered list "Select all"
  is otherwise a promise about rows the user cannot see.
- **The cost, accepted knowingly:** "who attends" stops reading as an event fact beside title
  and location. The summary sentence pays for it — it names the cohort in words, under the
  timing fields, in both layouts.
- `formatWallClock()` in `utils/facilityTime.js` exists so a stored `'HH:MM'` reads "6:00 PM"
  like every other time in the app rather than "18:00". It is a **pure string transform with
  no Date and no timezone** — a wall clock is already facility time, and running it through
  `new Date()` to format it would re-interpret it as an instant, the bug class `expand.js`
  warns about. It is **not** interchangeable with `formatFacilityTime()`, which takes a UTC
  instant. The roll sheet had the same raw-`07:00` display and now shares this.

**Editing an event is three tiers, and which tier a field is in is decided by what changing it
does to records that already exist** (built 2026-08-05). `PATCH /schedule/events/:id`,
managers.

The finding the whole design rests on: **`expand()` gates on `occursOn` BEFORE it looks at
materialized session rows** (`expand.js:101-103`). So changing the weekdays of a group with a
taken roll makes that session vanish from the board, the roll queue and the resident record
while its attendance sits orphaned in the table, reachable by no read path. It is the same
failure the soft-delete rule above warns about, arriving through an edit form.

- **Identity — `title`, `description`, `location` — is always free.** Renaming a group neither
  moves a session nor invalidates a mark.
- **The roster is always free, even on an event with months of history**, and that is the
  design working rather than a concession: the roster hangs off the occurrence and marks hang
  off the dated session, so taking somebody off next week cannot touch last week. This is the
  commonest real edit. A removal is soft, `one_live_attendee_per_occurrence` is partial so they
  can be added back, and `sessionRoll` keeps surfacing their old mark as `offRoster`.
- **Shape — `startsAtLocal`, `durationMinutes`, `recurrence`, `weekdays`, `startsOn`,
  `cohorts` — freezes the moment anything is recorded.** Refused with a 409 pointing at the
  move. Cohorts count as shape because adding one creates an occurrence and removing one takes
  its sessions with it, so cohort changes need no special case.
- **`endsOn` is always editable but never earlier than the last recorded date.** Shortening the
  window orphans history through the identical `occursOn` gate, which makes this the easiest of
  these rules to ship a bug in — ending a series is the *sanctioned* edit.

**`recordedAgainst()` is the ONE predicate**, and editing, ending and deleting all share it.
Three copies of "what counts as history" is how they come to disagree. It counts **attendance
AND cancellations** — a cancelled session is read by an auditor as "the meeting did not
happen", which is as much a claim about the past as a roll. A bare `startsAtLocalOverride` is
not: that is a decision about one date, and losing it costs an override rather than evidence.

**`deleteEvent`'s guard was attendance-only and now shares that predicate.** An event with
cancelled sessions and no marks used to delete out from under its `schedule_sessions` rows,
which can be neither soft-deleted (deliberately outside `SOFT_DELETE_MODELS`) nor hard-deleted
(`REVOKE DELETE`) — so those rows became permanently unreachable orphans.

**Moving a series is the answer to "the Tuesday group is Thursdays now"** —
`POST /schedule/events/:id/move`, managers. It ends the current series the day before `from`
and creates a successor there, carrying the roster, in one transaction. Every past date keeps
the rule that produced it, so the rolls stay exactly where they are. Two series is also what
the facility would say happened.

- `ScheduleEvent.supersedesId` is the link, borrowed from the amendment pattern in the schema
  footer. **`one_live_successor_per_event` is a PARTIAL unique index, not Prisma's `@unique`** —
  events are soft-deletable, and a total index would let a successor created in error and then
  removed block the original from ever being moved again. Prisma types the relation as
  one-to-many only because it demands `@unique` on the defining side of a one-to-one; the index
  is the real constraint. Same trade as `one_live_occurrence_per_event_cohort`.
- **The carried roster is filtered to ACTIVE stays.** A resident discharged mid-series stays on
  the *old* occurrence's roster — that is how their marks keep their context, and why a
  discharge costs no write to the schedule — but they are not on next month's group. Without
  the filter `cohortsOfStays` refuses the whole move the first time somebody has left, which is
  the common case for a series old enough to be worth moving.
- **The successor inherits `endsOn` only when it is still ahead of `from`.** After any move the
  old `endsOn` is `from - 1` by construction, so carrying it verbatim gives the successor an
  `endsOn` before its own `startsOn` and trips `occurrence_window_ordered` — which is exactly
  what a second move did before this was read *before* the overwrite.
- Refused when nothing is recorded (that is an ordinary edit, and splitting would leave a stub
  series with no sessions), when `from` is at or before a recorded date, and when a live
  successor already exists.

**Three client gotchas worth keeping:**

- **`.partial()` does not strip `.default()`.** A shape carrying `weekdays: …default([])` makes
  a PATCH of only `{title}` parse to `{title, weekdays: []}`, and `updateEvent` — which decides
  what changed from what is *present* — reads that as clearing the weekdays and refuses the
  whole edit as a frozen shape change. Defaults live on `createBody` alone; `eventShape` is a
  bare object so `patchBody` can be derived from it at all.
- **The soft-delete extension rewrites the TOP-LEVEL query only.** `getEvent`, `updateEvent`
  and `moveSeries` all spell out `deletedAt: null` on their nested `occurrences` and
  `attendees` includes. Without it a removed attendee keeps appearing on the roster, and adding
  them back is a silent no-op that returns 200.
- **`AppRollSheet`'s ellipsis needs `pe-9`.** `SheetContent` renders its own close button
  `absolute top-4 right-4`, which otherwise lands on top of the trigger and swallows every
  click on it.

**The UI is the edit dialog, the roll sheet's menu, and two small confirms.**
`AppEventEditDialog` is `AppEventCreateDialog`'s twin — same wide two columns, same
`AppEventForm`, `layout="columns"` above `md` and `/schedule/[id]` stacked below it. Shape
fields **disable with the reason and a "Move the series…" button** rather than disappearing,
the `AppApartmentEdit` `cohortLocked` pattern. The footer's left-hand action is **one action
that changes meaning** — "Delete event" while nothing is recorded, "End series…" once something
is — because only one of them can ever succeed and a permanently dead button teaches nothing.
`AppEventEndDialog` and `AppEventMoveDialog` follow `AppResidentDischargeDialog`: subject named
in the title, an optional reason, and the consequence in numbers ("3 recorded marks stay on the
current series, which ends Tue, Aug 4"). The roll sheet **emits `edit-event`** rather than
rendering the dialog, so the page can close the sheet first — it sets `pointer-events: none` on
the body, and two stacked modals is never the answer.

**Still to build:** per-date **cancel** — the columns and CHECKs exist, so
until then a cancelled meeting is recorded as everyone absent; and `apartmentId` on the
occurrence with an `(apartmentId, cohort)` composite FK, so a men's session structurally
cannot be scheduled in the women's apartment.

### 4. Apartment checks
**Built (2026-08-06).** Redefined by the facility before building: not the checklist
inspection sketched here originally, but the **hourly round** — staff walk each apartment
**every hour, 24/7**, account for everyone who should be on site, and record a **required
quick note** of what each present resident is doing. A checklist-with-photos inspection can
still layer on later; nothing here forecloses it. Chosen from rendered variants: an A/B
hybrid — no forced sequence, a round mode on the hallway hardware.

Two tables — `ApartmentCheck` (the visit) and `ApartmentCheckResident` (one resident's
line: `PRESENT` / `SIGNED_OUT` / `NOT_FOUND`). Lines reference the **stay**, like
sign-outs, so a discharge drops someone from future rosters with no write.

**The roster is derived, then snapshotted.** Who should be on site = occupants of the
apartment's beds; an open sign-out **pre-accounts** its resident as `SIGNED_OUT` (no tap —
the sign-out is the record), everyone else is marked present-with-note or not found. **A
travel pass pre-accounts the same way, as `ON_PASS`** (module 9, 2026-08-08) — its own
status rather than an overload of `SIGNED_OUT`, because a pass is not a sign-out and the
glossary forbids synonyms; `NOT_FOUND` is refused for somebody on one, and the bell's
RESIDENT_NOT_ACCOUNTED does not fire, since an approved absence is accounted for by
definition. The rules at the boundary, each enforced in the service AND asserted in the
suite:

- **The submission must cover the live roster exactly**, re-derived inside the
  transaction — an assignment or sign-out that changed between sheet-load and Save is a
  409 and a reload, never a check that misdescribes who was there to be counted.
- `PRESENT` needs a note — zod, service, **and a DB CHECK**. The CHECK carries an explicit
  `IS NOT NULL`: `length(btrim(NULL))` is NULL and **a CHECK passes on NULL**, so without
  it a NULL note walks straight through. There is an assertion pinning that guard.
- `NOT_FOUND` for a signed-out resident is refused — the sign-out accounts for them. A
  signed-out resident found on site may be `PRESENT`: truth wins.
- An empty apartment is an empty roster; a zero-line check is legal — the walk still
  counts, and completeness holds vacuously.

**"On site" excludes a travel pass, and it did not at first** (fixed 2026-08-08). The
board's headline figure — "1 of 3 on site" — was derived as *occupants with no open
sign-out*, so a resident away for the weekend was counted as being in the building, which
is precisely the claim this module exists to make false. It now reads through the same
`passesCovering()` the roster does. The check SHEET had the matching fault and a worse
symptom: it pre-accounted every non-IN presence as `SIGNED_OUT`, which the service refuses
with a 409 for somebody on a pass — so while anyone was away, **no round in that apartment
could be saved at all**. `!== 'IN'` was the whole bug in both places: two different facts
satisfy "not in the building", and only one of them is a sign-out.

**`checkedAt` is always the server clock.** A client-supplied time is an invitation to
back-fill the 2 PM round at 4; a round genuinely saved late lands in the hour it was
saved, which is the honest record.

**Everything hour-shaped is derived on read — no cron, no stored state** (the PRESENCE /
SESSION_STATE pattern; `CHECK_STATE` is a frozen constant, deliberately not a schema
enum). Buckets are facility wall-clock labels via `facilityHourKey()`; **the alarm is
rolling and bucket-free**: OVERDUE when `now − lastCheck > CHECK_INTERVAL_MS (60m) +
CHECK_GRACE_MS (15m)` — the grace knob in `services/checks.js`, same figure and reasoning
as sign-outs, and THE one derivation the page, bell and dashboard all share. DUE = no
check in the current bucket; MISSED = an elapsed bucket with none (history only, shown as
a callout in the day log). An apartment **never checked reads OVERDUE, not blank** — an
apartment nobody has walked is exactly what the alarm is for. DST needs no special case:
buckets come from stepping real 3,600,000 ms instants through the formatter and deduping
labels (fall-back merges the repeated 1 AM, spring-forward never emits a 2 AM), and the
alarm just measures elapsed milliseconds across either boundary.

**Append-only, stricter than `service_entries`: zero UPDATEs.** There is no verification
transition here, so both tables refuse every UPDATE and DELETE by trigger (what stops a
superuser) AND by revoked privilege (what stops the app role) — asserted separately, the
module 7 discipline. A correction is an **amendment**: a pure INSERT with
`supersedesId @unique` and a required reason, which **carries the original's `checkedAt`
verbatim** — it corrects what was observed, never when, so the amended check stays in its
own hour bucket — must cover **exactly the original's line set** (the visit already
happened; occupancy since is irrelevant), is re-validated **as of the original instant**
(a sign-out open *then*, not now), and is pinned to the original's apartment by trigger.
Both tables are deliberately absent from `SOFT_DELETE_MODELS` and present in
`AUDITED_MODELS` and `RLS_MODELS`; reset.js clears them by TRUNCATE for the same reason
as `service_entries`.

**RLS:** lines get the sign_outs policy verbatim (staff, or the resident's own stay);
**headers are staff-only** — the free-text apartment note can name other residents, and
nothing in the resident portal needs it. Widening later is one deliberate policy change.

**Recording and amending are all-staff** — the tech in the hallway is the one holding the
phone, and a mis-tap fix is a hallway act too. Same reasoning as sign-outs and the roll.

**The bell gains two ACTION kinds**, both derived through the module's own helpers
(`overdueApartmentChecks()`, `unaccountedResidents()` — the `overdueWhere()` pattern, one
knob shared with the dashboard's `attention.checksOverdue` / `attention.notAccounted`):
`APARTMENT_CHECK_OVERDUE`, and `RESIDENT_NOT_ACCOUNTED` for a latest-check `NOT_FOUND`
line on an active stay with no open sign-out — it clears itself on the next check, an
amendment, a new sign-out, or discharge. A name against "not found" is operational, the
same module-13 test the overdue sign-out item passes. **The status pill is untouched.**

**The UI is one page, one route, one sheet.** `/checks` is the picker on desktop —
apartment cards most-overdue-first (destructive inset on OVERDUE, warning Due chip, quiet
checked time), an hour progress line ("2 PM round · 2 of 5 checked"), and **the day's log
as one quiet line per round** — variant B's "Today's rounds", chosen 2026-08-06 over the
per-check list: "11 AM round · 2 apts · all accounted · 11:43 AM", a partial hour reading
"1 of 2 apts · Apt 14 missed", a not-found count in destructive. "All accounted" is a
claim about the whole round and is deliberately suppressed when an apartment was missed.
A line expands to its checks — the muted Amended badge with its reason, and the ellipsis
whose Amend action is the way into corrections.
On the hallway hardware — `(max-width: 767px), (pointer: coarse)`, the tap-floor query,
because width alone misses a tablet — a **Start round** button opens **round mode** at
`/checks/round` (Kasan's choice): a full-screen picker with a progress track, tap →
sheet → save → back to the picker, no forced sequence, a live deep link at every width.
`AppCheckSheet` is `AppRollSheet`'s twin (identity-keyed refetch watch, `pe-9` header,
one POST for the whole check, 44px floors): Present reveals **note chips** (Sleeping, In
room, Common area, Cooking, Watching TV — chips fill, typing edits), signed-out rows are
muted and carry **state and time, never a destination** (the census-tile rule), and Save
stays disabled until everyone is accounted and every present note is non-empty. Amend mode
is the same sheet fed by `GET /checks/:id`, entered from a log row's ellipsis — one sheet
per page, driven by refs. The page re-derives DUE/OVERDUE on the census's 30-second tick
(`checkState()` in `utils/facilityTime.js` mirrors the server), because crossing into
either mutates nothing and no socket event will come.

**A SIGNED_OUT line on the record explains itself with the sign-out's PURPOSE, never its
destination** (2026-08-08). The line used to read only "Signed out", which says a person was
accounted for but not why. `ApartmentCheckResident` stores no `signOutId` on purpose — the
covering sign-out is derivable from `stayId` + `checkedAt` containment — so the lookup was
always available; what needed deciding was what to show.

This is the **third ruling on the destination rule**, and the three are consistent rather
than ad hoc:

- **Withheld** on the census tile and the check sheet — a board glanced at with residents
  around, where where-somebody-went is nobody else's business.
- **Granted** to the bell and the dashboard's signed-out panel, because whoever acts on an
  overdue return needs to know where to start looking.
- **Purpose only** here. The record is a deliberate navigation to one named person, which
  is the argument that lets screens and medications show inline — but this trail is a
  **HISTORY**, and a run of destinations over weeks reads as a pattern of where a person
  goes, on a page any staff member can open. The purpose explains the absence without
  recording where they physically were.

**A known and accepted weakness, written down rather than discovered later:** `purpose` is
unreviewed free text, so the rule is enforced by **which column is read**, not by what the
column holds — nothing stops somebody typing a place into it. Note this is the *inverse* of
the ledger-description rule, where free text never crosses to Stripe *because* it can say
anything; here the free-text field is the one being displayed, so that defence is not
available. The only lever is at the point of entry, and `AppSignOutDialog`'s Purpose field
now carries a description and placeholder steering it to a reason ("Why they are out — not
where").

`signedOutAtWhere()` in `services/checks.js` is **the one definition** of who was signed out
at an instant, extracted from `amendCheck` when the trail needed the same question answered.
Two copies is how the amendment validator and the display come to disagree, and one of those
two is evidence. The trail resolves it in **one query per page, never one per line** — fifty
lines each doing a lookup is the per-row loop that is forbidden on a composed read.

**On the resident record (built 2026-08-06, chosen from rendered variants):** the rail's
Apartment checks section is READ-ONLY — a **"last seen" hero over a day-grouped trail** of
this resident's own lines, newest first. The hero goes destructive when they are
**unaccounted for**, derived by `residentCheckStatus()` — which is scoped through the same
per-apartment-latest-check predicate the bell uses (`unaccountedLines()`), deliberately
NOT "their newest line": during a bed move the old apartment's latest check still carries
their NOT_FOUND until that apartment is walked again, and the record must agree with the
bell about it. The same flag rides on `GET /residents/:id` as `current.checks`, lights the
rail's **red dot** and an Overview Needs-attention row. The trail is served by
`GET /residents/:id/checks`: current versions only (an amended check appears once, in its
original hour, marked), a **facility-day date filter** bounded by
`facilityWallClockToUtc`, and **keyset pagination** (cursor = base64url
`checkedAt|lineId`; Prisma's native cursor cannot cross a relation, so the keyset is a
hand-built (checkedAt, id) comparison over the `@@index([stayId])` that was put on the
lines table for exactly this read). The hero is computed on page one only — cursor pages
skip its queries. Active stay only, the Service/Ledger/Schedule precedent, with the same
three empty states.

### 5. Drug screening
**Built (2026-08-06).** A cup is read on site; **on a confirmable non-negative the RESIDENT
decides** whether the specimen goes to a lab, and is charged **$50** if they do. That
answers open question 6 — *both*, resident-elected — and it makes their decision the
record: **"he was offered confirmation and declined" is exactly the claim this module
exists to prove**, so declining is a value of its own and never an absence.

**Selection is recorded, never generated.** A screen is marked `RANDOM` or `FOR_CAUSE`
after the fact; there is no randomizer and no draw table, because there is no cron. A
randomizer would also be the first thing in this app that is *generated* rather than
observed, which is a different kind of record and wants its own design.

**One outcome plus substances**, not per-substance rows: `ScreenResult` is
NEGATIVE / POSITIVE / REFUSAL / DILUTE / PENDING, and a positive names what was found in a
`Substance[]` enum array. **REFUSAL and DILUTE are `--warning`, never red** — collapsing
them into "fail" destroys the fact that defends the facility, and is why the theme carries
`--warning` beside `--destructive` at all. `PENDING` means *collected and not read on
site* and reads as **"Not read"**; it is emphatically not "at the lab", which is
`REQUESTED`. Two different waits.

**The glossary's term wins: `witnessedById`, the collection witness.** Module 5's old
prose said "observing staff"; the glossary forbids synonyms. Module 6 keeps "observing
staff member" and that is not an inconsistency to tidy — watching somebody swallow their
own medication and taking custody of a specimen are different acts.

**No staff cohort or gender field was added**, and no witness-matching rule is enforced.
There is none in the schema, `Cohort` is explicitly forbidden from carrying gender
identity, and who witnesses whom is facility policy enforced by a rota rather than a
constraint.

**The collection half is immutable; the confirmation arc transitions write-once, one
way.** This is ServiceEntry's posture rather than module 4's zero-UPDATE one, because the
resident's decision and the lab's result are **later facts about the screen**, not edits
to it. The whitelist is a whole-row jsonb comparison, so a column added in six months is
immutable by default — and it is **necessary but not sufficient**: the arc guard is what
stops a lab result arriving alongside the decision, since both halves sit inside the
whitelist and a whole-row diff cannot tell them apart. Eleven whitelisted columns is the
widest UPDATE grant in the app; what makes it affordable is that every one is null until
its own event and the arc runs once, forwards.

**The lab is authoritative and the cup survives.** Nothing overwrites `result`. A
contradiction is two facts and the second does not unmake the first, so a contradicted
screen renders **both** chips — the cup struck through, the lab carrying the emphasis.
`effectiveResult`, `contradicted` and `refundDue` are all **derived on read**, never
stored.

**A lab result moves no money, in either direction.** If the lab clears somebody who paid,
the screen is **flagged** and a manager posts a credit by hand, case by case, through the
manager-gated ledger route — how much to refund is a facility judgement. A settled refund
is derived from a `CREDIT` whose `correctsId` points at the fee, so the review clears
itself and nothing needs remembering.

**`LedgerCategory` gains `LAB_FEE`**, and the $50 posts **server-side** from
`services/screens.js`. That does not weaken module 11's manager-only rule: **that rule is
a property of the `/residents/:id/ledger` ROUTE**, where a human picks an amount, a type,
a category and a description. Here the tech picks none of them — the price, the category,
the wording and whose ledger it lands on are all determined by the event being recorded.
The rule to carry forward: *a service may post to the ledger when every term of the entry
is determined by the domain event; anything a human chooses goes through the route.*
`LAB_CONFIRMATION_FEE_CENTS` is the one knob and `GET /screens` echoes it as `feeCents`,
so a dialog cannot quote a figure the ledger disagrees with.

**A known, accepted disclosure:** confirmation is only ever offered on a non-negative, so a
`LAB_FEE` line on a balance — which any staff member may read — implies a non-negative
screen. The description names no result and no substance, and this is written down rather
than discovered. **That disclosure is unchanged and still accepted** — internally, any
staff member reading a balance can still infer a non-negative from the category.

**The Stripe half was decided 2026-08-06, when invoicing shipped: the line reads "Testing
fee".** Invoice line text comes from `STRIPE_LINE_LABEL`, a fixed category map, and never
from the ledger's own description — which is unreviewed free text a manager typed and could
say anything. "Lab confirmation fee" would have narrowed to *this person had a non-negative
screen*, and the clearance covers identity, not clinical inference. `verify-ledger.js`
asserts the whole mapping, so this cannot regress into "just send the description".

**Nothing from this module reaches the bell or the dashboard.** Module 13 demands a
separate think before anything from module 5 goes near the bell; the think happened on
2026-08-06 and the answer is **no** — not a name, not a count, not a link. That is
structural rather than intended: `GET /residents/:id` carries no screens block, so no dot
can be hung on the rail, and `verify-screens.js` asserts the negative **against the
serialised `/notifications` and `/dashboard` payloads** rather than a list of known keys,
because a key-list assertion passes the day somebody adds `attention.screensPending`.

**`/screens` is three action bands over a quiet history** (variant A, chosen 2026-08-06
from rendered variants): *awaiting the resident's decision* — the loudest, because an offer
with no recorded answer is the gap this module closes — then *at the lab*, *confirmation
returned*, then *recent screens*. A negative never enters a band. **No clock tick**:
nothing here crosses a threshold on time alone, and a specimen at the lab a fortnight is
old rather than overdue, since the facility has no SLA to measure it against.

**Results are hidden until asked for, and the hiding is REAL.** `GET /screens` carries no
outcomes at all — no result, no substances, not even a lab result — and revealing a row
calls `GET /screens/:id`. That matters because CLAUDE.md's own rule is *"client-side hiding
is presentation, never protection"*: shipping every result and drawing a curtain would make
the audit log record one bulk read covering everybody on the page, destroying its ability
to answer **"who looked at whose result"** — which is the entire justification for techs
seeing the Clinical group at all. A reveal **auto-collapses after 30 seconds** and when the
tab is hidden, because a phone left face-up is the ambient case module 13 describes. Per
row only; there is deliberately no "reveal all".

**Band headings are neutral nouns** — "Confirmation returned", never "Refunds due" or
"Positives". The bands still imply the class of outcome for anyone in them, and that is
accepted knowingly: what the reveal protects is the **specific** result, which is the
damaging part over a shoulder. Do not add a "Positives" filter chip.

**On the resident record** the section is read-only and carries **no dot** — decision 7
reaching the record page — and it is **a counts band over a month-grouped history**
(variant B, chosen 2026-08-06 from three rendered variants; a standing hero and a
card-per-screen were the others). The Schedule section's attendance idiom applied to
screens, so the record's two history-shaped sections read the same way.

**Results are VISIBLE INLINE here, and that is a deliberate exception to the reveal.**
`/screens` lists many people at once and keeps its fetch-on-reveal boundary; a record page
is a deliberate navigation to ONE named person somebody already chose — which is precisely
module 1's argument for techs seeing the Clinical group at all. The cost, stated: the audit
unit becomes *"opened this resident's screens"* rather than *"looked at these three
results"*. On a page about one person that is the right grain; on the queue it would not be.

**Counts, never a percentage** — a resident may have two screens, and "50%" implies a
measurement where "1 of 2" carries its own sample size. The band hides entirely when
nothing is recorded, the `attendanceSummary()` rule: a 0-of-0 bar reads as a failing grade
rather than as an absence of information. **An OVERTURNED screen is its own bucket and its
own muted segment** — counting it positive would contradict the lab being authoritative,
and counting it silently negative would hide that a cup once read positive, which is a
fact the facility may have to explain. There is an assertion that the buckets sum to the
total, so no screen can be counted twice or dropped.

**`GET /staff`** was added for the witness picker: staff-only, returning active staff names
and roles, excluding RESIDENT so a resident's linked account can never appear as a pickable
witness. Colleagues' names are not resident data. Module 6 will be its second consumer.

**Still to build:** whether the collection was *directly observed* (a materially different
custody fact from who witnessed, and a dignity question the facility has not been asked),
and attaching the lab's own report — blocked on object storage **and** open question 8, so
the lab is a text reference for now, the `ServiceEntry.supervisorName` precedent.

### 6. Medication administration
**Built (2026-08-07).** The facility's model was confirmed before building, which is what
this section used to demand and what open question 3 held: **staff-stored, resident
self-administered**. The house holds the medications; staff hand a dose over and observe it
being taken. **Staff never administer**, so this is not a clinical MAR — no route, no site,
no PRN protocol, no prescriber entity.

**The house stores NO controlled substances**, so there is no count, no on-hand figure and
no reconciliation anywhere in this module. That is the facility's answer to "controlled
substance counts if the house stores any" — **foreclosed, not deferred**. A count subsystem
was designed and dropped the same day on that answer; if the house ever holds a controlled
med it is a new slice with its own evidence rules, not a column added here.

Two tables — `Medication` (the standing instruction) and `MedLog` (the dose as observed) —
and the split between them is the module's spine. **A medication is current state; a dose is
evidence.** `medications` is freely updatable and soft-deletable, the `maintenance_requests`
posture; `med_logs` refuses every UPDATE and DELETE by trigger *and* by revoked privilege,
stricter than `service_entries`, which keeps one write-once UPDATE for verification. A dose
has no transition at all, so there is nothing to grant.

Two rules keep the editable half safe, and both are the same rule other modules learned the
hard way:

- **`MedLog` snapshots `medicationName` and `dosage` at the dose.** Raising somebody's dose
  next month must not restate what was handed over last week. Deliberately a second copy
  that *may* disagree, exactly like `Invoice.totalCents` — and it is what buys `Medication`
  its editability. Without the snapshot every field there would have to freeze the way a
  schedule event's shape does. An amendment carries the snapshot forward verbatim rather
  than re-reading the medication.
- **A medication with any dose logged cannot be deleted, only ENDED** (`endsOn` + a required
  reason). Soft-deleting it would make the soft-delete extension filter it out of every read
  and silently erase the dose history hanging off it — the identical failure the
  `ScheduleEvent` rule warns about. And `endsOn` is never earlier than the last recorded
  dose, because reads filter medications to those standing on a date, so shortening the
  window orphans a dose through exactly the gate `expand()` orphans attendance through.
  Ending a medication is the *sanctioned* act, which is what makes that the easiest guard
  here to ship a bug in.
- **On the day it ends, only doses that were actually RECORDED survive** (fixed
  2026-08-08). `endsOn` stays inclusive — the medication was in effect that day — but the
  expander drops any dose on that date with no log against it. The two alternatives each
  lose something real, which is why this is worth stating rather than deriving:
  keeping every dose leaves a medication somebody deliberately stopped reading DUE and
  then **MISSED**, and that second one is a *false record* — it asserts the facility failed
  to give a dose it had decided not to give, in a module whose whole posture is that
  records are evidence. Dropping every dose instead takes this morning's, which really was
  handed over and observed, and that is worse. So what happened stands and what was never
  going to happen never appears. The guard above is unaffected, because a recorded dose is
  exactly what still shows. Found in the seeded data as a discontinued Trazodone still
  showing a dose due that evening.

**A dose inside a TRAVEL PASS is skipped, not missed** (module 9, 2026-08-08) — the
identical shape as the `endsOn` filter above, and for the identical reason. Without it a
three-day pass reads as a run of MISSED doses: a false record asserting the facility failed
to medicate somebody who was not in the building. `expandDoses()` takes the passes
overlapping the window from `passesOverlapping()`, the same one query the check roster and
the roll sheet read, so none of the three can disagree about who is away.

**MISSED is derived and must never become storable.** CLAUDE.md's own sketch said the log
was "given / refused / missed / held"; three of those four are stored. `MedLogStatus` is
`GIVEN | REFUSED | HELD`, and `MED_DOSE_STATE` adds `UPCOMING`, `DUE` and `MISSED` as a
frozen constant, the `CHECK_STATE` / `PRESENCE` / `SESSION_STATE` pattern. A missed dose is
the **absence** of a record: making it typeable would render "nobody ran the pass"
indistinguishable from "we ran it and marked everyone missed", and the first is the evidence
gap the alarm exists to find. **HELD carries a required note** and is what staff reach for
when a dose was deliberately not given — asleep, at work, held pending a prescriber call.
**REFUSED is `--warning`, never `--destructive`**, the module 5 rule: a resident declining is
a choice and a fact that defends the facility. MISSED gets the red.

**Times are wall-clock `'HH:MM'` strings on the medication, converted per date** by
`facilityWallClockToUtc()` — `ScheduleOccurrence.startsAtLocal`'s rule verbatim, and
`lib/facilityTime.js` has said "med windows will reuse this" since sign-outs. An 8pm dose is
8pm on both sides of a DST boundary; an instant drifts an hour in November. A **PRN**
(as-needed) medication carries no times, never reads DUE, and its log has a null
`scheduledFor` — which is why the one-live-log-per-dose trigger exempts a null slot: a
resident may honestly take an as-needed medication twice in a day.

**Nothing is materialized and there is no cron.** A dose exists because a medication carries
a time and a date came round; a row exists only because somebody recorded an observation.

- **`MED_PASS_GRACE_MS` is TWO HOURS** (facility, 2026-08-07) — `medMissedCutoff()` in
  `services/meds.js` is THE one knob, shared by the board, the bell and the record.
  Deliberately much wider than its siblings, and the difference is the point: `OVERDUE_GRACE_MS`
  and `CHECK_GRACE_MS` are fifteen minutes because a sign-out lags a deadline a resident
  promised and an hourly round is a cadence staff control, whereas an evening med pass drifts
  with when people get home from work. At fifteen minutes it would fire most evenings on a
  house doing nothing wrong, which is how a signal stops being read.
- **The board ticks at 30 seconds**, like the census and unlike `/screens`: a dose crossing
  into MISSED is no write, so no socket event will come. `utils/meds.js` mirrors the server's
  `doseStateOf()` for exactly that re-derivation.
- **No backfill.** `recordDoses` takes no date and always writes today — a dose missed on
  Tuesday cannot be given on Thursday, and recording it then is falsifying rather than
  catching up. A dose whose time has **not yet come** is refused too (recording an observation
  nobody has made, the `checkedAt`-is-always-the-server-clock reasoning). A **late** dose *is*
  recordable: the observation genuinely happened, and `scheduledFor` against `createdAt` says
  exactly how late without anyone claiming otherwise.

**A dose is answered once**, enforced by trigger — a partial unique index cannot express
"live", since that depends on whether *another* row supersedes it. The service returns a
friendly 409 first; the trigger is the enforcement and the 409 only its face, the
`assignBedTo` pattern. Corrections are the amendment pattern: a pure INSERT carrying
`medicationId`, `stayId` and `scheduledFor` verbatim, `supersedesId @unique` so a forked
chain is structurally impossible, and a trigger pinning the amendment to the same medication.

**Roles split on one line: observing a dose is a hallway act, deciding what somebody takes is
not.** Recording and amending are **all-staff** — the tech at the lockbox is the one holding
the phone, and making them find a manager is how a pass ends up on paper, the sign-out, roll
and hourly-round reasoning. Changing the **med list** is **managers-only**, the same line as
setting a service-hours target or setting the schedule.

**Both tables hang off `Stay`**, like the ledger, sign-outs, service hours and check lines,
with a **composite FK `(medicationId, stayId)`** so Postgres itself refuses a log claiming
one stay against another's medication. A discharge therefore drops the resident off every
future pass **with no write at all** — asserted, because it is the property the stay-scoping
buys.

**The privacy boundary is the shape of the API, not a client decision.** `GET /meds` carries
**no medication name, dosage, prescriber or pharmacy** — resident names and counts only,
because it is a work queue like `/service` and you cannot run a pass without knowing whose it
is. A drug arrives solely from `GET /meds/pass/:stayId`, one resident at a time, because
somebody opened their sheet. That is module 5's reveal reasoning at the right grain, but
**without** the 30-second auto-collapse: a med sheet is the tool for *doing* the pass and a
curtain closing mid-hallway is friction rather than protection. The cost, stated: the audit
unit is "opened this resident's med pass" rather than "read this medication". On the resident
record medications **are** named inline, the same exception and the same justification as
screens there — a deliberate navigation to one person somebody already chose.

**The bell carries a count and a time, never a name or a medication.**
`services/notifications.js` has warned since it was written that nothing from module 5 or 6
belongs in a bell "without a separate think about who is standing behind the phone". The
think happened on 2026-08-07 and the answer is `MED_PASS_DUE` — "3 doses not yet recorded ·
3:00 PM med pass · 2 residents". Deliberately shaped unlike `RESIDENT_NOT_ACCOUNTED`, which
names somebody: the difference between those two items is the whole of module 13's rule. It
counts **DUE doses only, never MISSED** — a derived item has to be clearable by doing the
thing it names, and a missed dose can never be recorded, so counting them would sit in the
bell forever with nothing anybody could do about it.

**RLS is staff, or the resident's own stay** — the `sign_outs` policy shape on both tables.
Unlike `apartment_checks`, whose header is staff-only because its free-text note can name
other residents, nothing here describes anyone but the one resident the row is about, so the
own-stay read is written now rather than deferred. It is what the resident portal will use.

**On the resident record** the rail's Medications section is READ-ONLY — the current list
over a day-grouped, keyset-paginated dose trail, with discontinued medications kept visible
because a medication somebody was on until last week is exactly what a prescriber asks about.
It carries **no dot**, the `AppResidentScreens` rule: a dot on a Clinical section is an
ambient clinical signal on every screen that draws the rail.

**Still to build:** whether a dose was directly observed versus handed over and trusted is a
distinction the facility has not been asked about; photographs of a med sheet or a label are
blocked on the same object storage as module 1's documents; and resident self-service — the
RLS read is already in place, so it is a UI decision rather than a schema one.

### 7. Community service
**Built.** Hours are logged against a **stay** with a date worked, a location and an outside
supervisor; staff verify them; **only verified hours count** toward a target; and a resident
falling behind lights the rail amber. This is what makes module 1's amber dot real.

**The target is the phase default, overridable per stay.** `Program.serviceHoursRequired`
finally does something — it is the figure for the phase — and `Stay.serviceHoursRequired`
overrides it when a court or a case manager sets a different one. On the **stay** rather than
the resident so a readmission starts fresh, and rather than the program so **an 80-hour order
survives a phase change** instead of shrinking to 40 when somebody moves up. Both null means
no target: no bar, no dot, the same "absence of a signal means fine" rule the census follows.

**The pace is 20 hours a month** (facility policy, chosen 2026-08-05).
`MONTHLY_SERVICE_QUOTA_HOURS` is THE knob — the dot, the bar's marker and the "behind by"
figure all derive through `servicePace()`. Two details are the rule, not decoration:

- **It accrues in whole monthly steps**, thirty days from intake. Continuous accrual would
  make a resident 0.7 hours behind on day two and amber on day three, which is the noisy-dot
  failure this file warns about twice. Whole steps make the first month grace by
  construction rather than by a second knob. Thirty days from *their* intake rather than a
  calendar month also avoids needing a policy for the partial first month — somebody who
  arrives on the 28th does not owe twenty hours in three days.
- **It is capped at the target.** Without the cap, a resident who finished all 80 hours in
  month two goes amber in month five because 20 × 5 > 80 — a dot on somebody who is *done*,
  which is how a dot stops being read.

Cumulative, not a monthly reset: **the quota exists to catch somebody not working the hours
off, not to enforce a rhythm.** Work ahead and it banks.

`servicePace()` is pure and lives on the **server**, because the resident portal will need
the identical number, because only verified hours count, and because a quota is facility
policy — which belongs beside `OVERDUE_GRACE_MS`, not in a Vue file. `sectionDots()` only
reads the boolean. **No ticking clock**: `behind` does change on the calendar alone like an
overdue sign-out, but it crosses once a month rather than once an hour, so the next page load
is soon enough. Do not add a timer by analogy with the census.

**`service_entries` is the first table to implement the amendment pattern**, and modules 4, 5
and 6 will copy it — so the shape matters beyond this module:

- **A correction is a PURE INSERT.** The footer block in `schema.prisma` used to prescribe a
  `supersededById` back-pointer on the original as well; it was **dropped 2026-08-05**.
  `A.supersededById = B.id` holds iff `B.supersedesId = A.id`, so it was a second copy that
  could disagree — and writing it was an UPDATE on a table whose whole point is that it has
  none. `@unique` on `supersedesId` also makes a **forked chain structurally impossible**,
  which the two-column version needs a separate guard for.
- **Exactly one UPDATE survives: verification.** Module 11 refused to let `ledger_entries`
  take a "billed" flag because *"only this one column, only null → value" is how an
  append-only table stops being append-only* — and that reasoning is honoured here, not
  overridden. There the flag was **extrinsic** (an invoice is a separate thing, so it got a
  join table); verification is **intrinsic** — an attestation about *this* row — and a join
  table would be a second row saying "row 4 is true", which is worse.
- The trigger is a **whitelist written as a whole-row comparison**, not a list of column
  names, so **a column added in six months is immutable by default** rather than silently
  mutable because nobody extended the list. It is write-once in both directions: never
  verified → unverified, and never a change of verifier, which would move somebody's name
  onto a claim they did not make.
- The privilege agrees with the trigger rather than relying on it: `REVOKE UPDATE, DELETE`,
  then `GRANT UPDATE ("verifiedAt", "verifiedById")`. The app role fails on privilege before
  a trigger is reached; a **superuser** — which bypasses RLS even with FORCE — fails on the
  trigger. `verify-service.js` asserts both separately, because a test that conflates them
  proves neither.
- **Minutes are stored, hours are displayed.** The ledger's integer-cents reasoning, applied
  to time: 3.5 h is 210 and sums exactly. The target stays whole hours — an order says "80
  hours", never 79.75 — and the only hours figure anywhere is the one a human types.
- A **void** is an amendment to zero minutes with a reason. A CHECK permits zero only there:
  an original claiming no work done is a half-filled form that reached the table.
- An amendment **starts unverified**. The original's sign-off was an attestation about
  figures that have just changed.

**Every paired-nullability CHECK here spells out `IS NOT NULL`**, and that is not
belt-and-braces: `length(btrim(NULL))` is NULL, `FALSE OR NULL` is NULL, and **a CHECK
constraint passes on NULL** — it only rejects on FALSE. `service_amendment_reason_paired`
shipped without it and accepted a reasonless amendment until it was replaced
(issue #1, fixed 2026-08-06 in a new migration, since an applied one is immutable).
Copy this shape for any new table taking the amendment pattern.

**Roles:** logging and **verifying are all-staff**, matching sign-outs — the tech handed the
signed slip is the one at the door, and making them find a manager is how it ends up on
paper. Setting the **target is managers-only**: an obligation is not a hallway act. When
residents submit from the portal, the control that matters is that the verifier is *not the
resident*, which all-staff satisfies by construction.

**Planned: resident self-submission.** The RLS write policy currently refuses resident actors
outright; relaxing it means a deliberate INSERT-only policy scoped to their own active stay —
the same shape module 8 plans for self-sign-out — with verification staying staff-only. The
read policy is already in place: a resident can read their own hours today, which is what
CLAUDE.md's role table has always promised.

**`/service` is two bands — the verification queue over the progress list** (chosen
2026-08-05 from three rendered variants; a single filterable table and a card-per-resident
board were the others). The shape is sign-outs with different nouns, and the reason is that
**verification is the only thing on the page with a clock on it**: an unsigned slip is hours
that do not count, and hours that do not count are hours the facility cannot show anyone. So
it goes first, and it is one tap.

Both rejected variants failed on the same axis and are worth remembering. The table reads
better as a *reference* view but hides the time-sensitive action behind a filter chip, and
its default tab is the least actionable one. The card board is the prettiest and puts a
"Verify 3.5 h" button on a *person* — which is a lie the moment somebody has two slips
pending, and fixing it means opening a sheet, at which point the flat queue was simpler.

- **`GET /service` is one read** returning `{ pending, progress, figures }`, like `/census`
  and `/schedule` — a page rendered from one read cannot show two halves that disagree
  because one loaded a second later. Pending is **oldest work first**: a slip that has sat a
  fortnight is the one at risk of never being signed. Progress puts whoever is **furthest
  behind** at the top.
- **The queue is deliberately uncapped.** The schedule board's roll queue caps at four
  because it can hold weeks of stale history; every row here is a slip somebody is waiting
  on, and a queue that hides work is worse than a long one.
- **Names appear on this page**, unlike the census tiles or the schedule board. It is a work
  queue: you cannot verify somebody's hours without knowing whose they are.
- **Residents with no target sit in their own quiet group** at the bottom rather than reading
  "0 of 0" among the rest. Nothing is owed, so nothing is wrong — the same rule as everywhere
  else.
- `AppServiceProgress` gained a `compact` prop rather than the page hand-rolling a second
  bar, so the pace marker's logic exists once and the two densities cannot drift.

### 8. Sign-outs
**Built.** Staff record the departure — destination, optional purpose, out time, expected
return — and acknowledge the return; both are **all-staff** actions, because the tech at
the door is the one doing them. The page is a two-band list: everyone out as a card with
one big Back button (most overdue pinned on top), completed returns as quiet history
lines. Recording in error is fixable by any staff, but only while open: **a completed
return is history and can never be deleted.**

The rules that hold it together:

- **One open sign-out per stay**, enforced by a raw-SQL partial unique index (Prisma
  cannot express it). Soft-deleting an erroneous record frees the slot.
- **Presence (in / out / overdue) is derived, never stored** — from `returnedAt` and
  `expectedReturnAt` against the clock. `PRESENCE` is a frozen constant, deliberately not
  a schema enum.
- **Overdue = expectedReturnAt + 15 minutes of grace** (facility policy, chosen
  2026-08-02). `OVERDUE_GRACE_MS` in `services/signOuts.js` is the ONE knob — pill, bell,
  census and page all derive through `overdueCutoff()`. The "Overdue 2h 41m" label still
  measures from the expected return; grace delays the alarm, not the arithmetic.
- **Times cross the wire as facility wall-clock strings** ("17:30" + optional date) and
  the SERVER interprets them via `lib/facilityTime.js` — the first consumer of
  `FACILITY_TIMEZONE`, and the pattern curfews, med windows and passes should reuse. A
  manager recording from another timezone still writes facility time.
- **Crossing into overdue mutates nothing** — no write, no socket event — so the census
  and sign-outs pages keep a 30-second client tick that re-derives chip state and nudges
  the pill and bell. Any state that crosses a threshold on the clock alone needs this
  pattern; **module 9's pass expiries do too** (built 2026-08-08) — `/passes` and the
  census both tick, against `PASS_GRACE_MS`, which is **one hour and its own knob**: an
  hour late back from a weekend away is not the same event as an hour late back from the
  shop.
- The census tile carries presence **state and times only, never the destination** —
  where somebody went is for the sign-outs page, not a board glanced at with residents
  around. The bell's overdue item does carry it: whoever acts on an overdue return needs
  to know where to start looking.
- A return and its acknowledging staff member arrive together or not at all (CHECK
  constraint); `sign_outs` carries full RLS (residents see only their own) and
  `REVOKE DELETE`, so even direct SQL cannot hard-delete one.

**Planned: resident self-sign-out, Phase 2 and above, daytime only.** Residents at
Phase 2+ will sign themselves out through their portal; **returns are always acknowledged
by staff at the office** — that half stays exactly as built. What self-sign-out needs
when it comes, so it is a decision and not a drift: the RLS write policy currently
refuses resident actors entirely (`sign_outs_write` requires `app_is_staff()`), and
relaxing it means a deliberate INSERT-only policy scoped to the resident's own active
stay; a phase gate read from the stay's program level; a daytime window, which is
facility policy nobody has defined yet (hours, and whose clock — `FACILITY_TIMEZONE`
answers the second); and `recordedById` already handles attribution, since a resident's
User links to their Resident row.

### 9. Travel passes
**Built (2026-08-08).** The last operational module, and the one three built modules had
already promised by name. An overnight or multi-day approved absence: request → review →
approve or deny with a reason → acknowledge the return. **The bed is held throughout** —
the census shows "on pass", never an empty tile.

**Facility decisions (2026-08-08):** managers and admins approve, **filing stays
all-staff**; eligibility is enforced **per phase** — Orientation is not eligible at all,
**Phase 1 and above need 90 days** in the programme; **Phase 3 was added** (level 3, 60
service hours), because the glossary has said "Phase 1 / 2 / 3" since the beginning and
the seed only ever had two; the overdue grace is **1 hour**; and a pass satisfies
**apartment checks, med doses and group attendance**.

**The bed hold cost nothing to build, and that is the schema being right two modules
early.** `BedAssignment`'s own comment already said *"a resident out on a travel pass still
holds their bed. Presence is a separate question answered by sign-outs and passes."* So
nothing in this module touches bed history — and because a reader is more likely to assume
that than check it, `verify-passes.js` asserts it on the **row**: the same assignment id,
the same `startedAt`, still open. An assignment ended and re-created would leave the census
looking identical while rewriting permanent evidence.

**One table, and the review is an ARC rather than an amendment.** `travel_passes`, with the
`drug_screens` posture: the request half — destination, purpose, dates, who asked — is
immutable, and approving is a **later fact about** the request rather than an edit to it.
The trigger is a **whole-row jsonb whitelist**, so a column added in six months is immutable
by default; the arc runs `REQUESTED → APPROVED|DENIED → CANCELLED|RETURNED`, **once and
forwards**. Append-only is enforced at **both layers and asserted separately** — `REVOKE
UPDATE, DELETE` stops the app role on privilege, the trigger stops a superuser.

**A denial requires a reason, in the route, the service AND a CHECK.** A refusal with
nothing stated is what a resident appeals and the facility cannot defend. Cancelling an
approved pass is the same act from the other direction and carries the same requirement.
Every paired CHECK spells out `IS NOT NULL`, the issue #1 rule.

**Withdrawing is soft and only while UNDECIDED** — the sign-outs shape: fixable in error,
but only while nothing has been recorded against it. Once a manager has decided, the
decision is what an auditor reads and it stays.

**`passEligibility(stay)` is a PURE predicate returning `{ eligible, reason }`**, checked in
the service rather than in middleware, because it depends on the resident's program and
their days in the programme — not on the actor. It returns the *rule*, not just a refusal,
which is why the request dialog and the record's Eligibility band can show "Phase 1 needs 90
days in the programme — this is day 12" **before** somebody types a destination. A **null**
`passEligible` reads as *not granted* — the conservative posture, the same as a null
service-hours target meaning no target. Eligibility is **re-checked at review**, since a
request can sit in the queue across a phase change.

**`PASS_GRACE_MS` is one hour and is its own knob**, beside `OVERDUE_GRACE_MS` (15m) and
`CHECK_GRACE_MS` (15m). An hour late back from a weekend away is not the same event as an
hour late back from the shop, and `passOverdueCutoff()` is THE cutoff the page, the census,
the bell and the dashboard all derive through.

**THE BOUND THAT MATTERS: an overdue pass is still an absence.** `coversInstant()` is
bounded by the **departure only** — `returnBy` does not close it. This was shipped the other
way first and caught before merge, and the failure is worth recording because every symptom
was somewhere else: with `returnBy >= at`, the moment somebody became overdue the census
dropped them back to "in", the hourly round stopped pre-accounting them, and their doses
came due and began reading MISSED. The app would have asserted a resident was home *because
they had failed to come home*. An APPROVED pass is in force until it is returned or
cancelled, however late it runs, and there is an assertion pinning it.

**Presence is ONE derivation, extended rather than duplicated.** `PRESENCE` gains `ON_PASS`
and `PASS_OVERDUE`, and `presenceOf()` in `services/signOuts.js` — which has exactly two
callers, `rosterFor()` and the census — takes the covering pass alongside the open sign-out.
A second `passPresenceOf()` beside it is how the census tile, the check roster and the
record come to disagree about whether somebody is in the building. **A pass OUTRANKS a
sign-out** when both somehow exist: the multi-day sanctioned absence is the larger fact, and
a stale open sign-out underneath one must not downgrade the display to "out for the
afternoon".

**The three integrations, all DERIVED — nothing is written ahead:**

- **Apartment checks.** `CheckResidentStatus` gains **`ON_PASS`** rather than overloading
  `SIGNED_OUT`: a pass is not a sign-out and the glossary forbids synonyms. The roster
  pre-accounts them (no tap — the pass is the record), `NOT_FOUND` is refused for somebody
  on one, and the bell's `RESIDENT_NOT_ACCOUNTED` does not fire, because an approved absence
  is accounted for by definition.
- **Med pass.** `expandDoses()` skips doses falling inside an active pass — the same shape
  as the discontinued-medication filter, and for the same reason: without it a three-day
  pass reads as a run of MISSED doses, a false record of the facility failing to medicate
  somebody who was not there.
- **Group attendance.** `sessionRoll` flags an on-pass attendee and **`AppRollSheet`
  pre-selects EXCUSED, muted, with the pass as the reason** — the check sheet's signed-out
  row pattern. **"Mark all attended" skips them**, or one tap would record a resident as
  present at a group they are two hundred miles from.

**Writing EXCUSED marks at approval was in the plan and was rejected**, and the reason is
structural rather than aesthetic: `recordedAgainst()` in `schedule/write.js` counts
attendance rows, so approving a five-day pass for somebody on a daily group would **freeze
that event's shape** and refuse a manager's reschedule with a 409 giving no hint why.
Pre-selecting instead keeps the mark real and human-authored — a person opened the roll and
saved it — and `verify-passes.js` asserts the attendance count does not move when a pass is
approved.

**Roles follow one line: FILING IS A HALLWAY ACT, DECIDING IS A JUDGEMENT.** A tech is who a
resident actually asks, and making them find a manager to type it is how a request never
gets filed — the sign-out, roll-taking and hourly-round reasoning. **Acknowledging a return
is all-staff** for the same reason a sign-out's return is: the person at the door sees them
walk in. `returnedAt` is the **server clock**, since a client-supplied time is an invitation
to back-date a late return into an on-time one.

**`/passes` is a REVIEW QUEUE over who is away, then history** (variant A, chosen 2026-08-08
from three rendered variants; a fortnight calendar and a filterable table were the others).
A request is the only thing on the page with somebody waiting on it — a resident who does
not yet know whether they can go — so it leads even on the days it is empty. It **names
residents and carries destinations**, like `/sign-outs` and unlike the census: it is a work
queue read by one person deciding what to do. **A 30-second clock tick**, the census pattern,
because a pass crossing into overdue is no write and no socket event will come.

The calendar is the fallback, recorded so it is not re-proposed as new: it becomes the right
layout once passes are frequent enough that **overlap** is the question, which no other
framing answers. The table lost for the reason the maintenance table won on its own page —
there is one urgent act here, and a filterable list buries it.

**Approving has no dialog; denying does.** Approval needs nothing from the reviewer, and a
confirm that asks for nothing is a click that teaches people to click. Denial gets a dialog
because denial has a cost and needs its reason.

**On the resident record** the Travel passes section leads with an **Eligibility band**,
which no other rail section does. A pass is the one thing on the record somebody is refused
by *rule* rather than by judgement, so the band states the rule; the Request button renders
only when they are eligible, and its absence is not silent because the band beside it says
why. The section carries **no dot** — a pass is not a thing going wrong.

**The census tile keeps its name and its occupied styling** and gains a muted "On pass ·
back <date>" chip; late reads "Overdue back 2h 41m" in destructive with the inset. **Dates,
never a clock time**, because a pass spans days and "back 5:30 PM" on a Thursday pass reads
as today. **Never a destination**, on the tile or the roll sheet or the check roster — that
board is glanced at over a resident's shoulder. The **bell's overdue item DOES carry it**,
the same exception the overdue sign-out has: whoever chases somebody needs a place to start.

**The figures count `onPass` BESIDE `occupied`, never instead of it** — that is the bed hold
made visible, and it is what stops the board reading as though a bed came free. The tile's
three tones are the urgency: destructive when somebody is late (either kind), warning when
they are out and due back within hours, muted for an approved multi-day absence, which is
not a thing to act on.

**A gap this module's own suite caught on its first run, recorded because it is the exact
failure this file exists to warn about:** `ON_PASS` shipped in the schema, in
`validateLines()` and in the check sheet — while `routes/checks.js` still typed its status
enum as three literal strings. So the one path that could ever set it answered **400**, and
every screen looked plausible. It is module 10's `vendorName` in a different costume, and
the fix is the general one: the route derives its enum from `CHECK_RESIDENT_STATUS` rather
than re-typing it, so a status added to the domain constant cannot be one the route silently
refuses.

**Still to build:** **blackout rules by date** — CLAUDE.md's original sketch said "blackout
rules by program phase", the phase half is built, and a facility-wide blackout calendar is
not, because nobody has been asked for one; resident **self-request** from the portal, which
is the same INSERT-only RLS relaxation modules 7 and 8 both plan; and whether a pass should
suppress the **curfew** check, which is not built either.

### 10. Maintenance
**Built 2026-08-02, planned out properly 2026-08-07.** Requests raised against an
apartment: title, description, priority, status. Any staff may file one; admin and house
managers close them, and closing requires a resolution note. Deliberately independent of
`Bed.status` — maintenance is a property of the unit, out-of-service is a property of the
bed, and neither drives the other.

That paragraph was the entire section for five days, and it showed: **two of the four
statuses were unreachable from any screen**, a NORMAL request could sit for six weeks and
appear nowhere, and the facility's real workflow was leaking into free text — the seed
read `"Window latch broken — work order 118"` with `"Vendor scheduled."` in the
description, because there was nowhere else to put either. Four facility decisions on
2026-08-07 fixed the rules rather than the symptoms.

**A request is late against its OWN priority's target.** `MAINTENANCE_TARGET_MS` in
`domain/constants.js` — **URGENT 24h, NORMAL 7 days, LOW 30 days** — and
`overdueRequestWhere()` in `services/maintenance.js` is **THE one knob**, the
`overdueWhere()` / `urgentOpenWhere()` idiom: one `where` with an OR arm per priority,
shared by the page, the bell and the dashboard so the three cannot disagree about what is
late.

- **Measured from `reportedAt`**, not from the last time anybody touched it. "How long has
  this been broken" is the question, and re-prioritising a request or assigning it to
  somebody does not make the tenant's shower work.
- **Derived on read, never stored** — no cron, no flag, and changing a target re-reads
  every request correctly instead of needing a backfill.
- **No clock tick on the page.** The census and sign-outs tick at 30s because a resident
  crosses into overdue within the hour; the schedule board refetches at 60s. A request
  crosses at **24 hours at the soonest**, so the next page load is soon enough — the
  explicit `servicePace()` reasoning ("do not add a timer by analogy with the census"),
  and the same call `/screens` made.
- **`urgentOpenWhere()` was KEPT, not replaced.** An urgent request filed twenty minutes
  ago is a hazard and belongs in the bell before any clock has run. The bell and dashboard
  key on the **union** — urgent-and-open, OR overdue against its own target — and
  `verify-maintenance.js` asserts that the bell's set is exactly that union and no third
  rule. The bell item's detail says *which* of the two put it there, because they call for
  different things; overdue wins when a request is both.
- **The bell item now links to `/maintenance`, not `/apartments/:id`.** The apartment page
  is manager-only, so the old destination sent a tech to a screen they cannot open.

**`IN_PROGRESS` means somebody owns it.** The state earns its place by carrying an owner:
`assignedToId` (a staff `User`) **and** `vendorName` + `workOrderRef`, deliberately **not**
mutually exclusive — a house manager who owns the job and called a plumber is one request,
not two. A CHECK refuses `IN_PROGRESS` with neither, and the vendor branch spells out
`IS NOT NULL` for the reason written on `check_present_needs_note`: `length(btrim(NULL))`
is NULL and **a CHECK passes on NULL**, so without it a NULL vendor name walks straight
through. There are assertions for the NULL *and* the blank case.

Taking a job is a hallway act, so `POST /:id/start` is **all-staff** and **defaults the
assignee to the actor** when nobody is named and no vendor given. A tech taps "I'm on it"
once and the state is true; making them fill in a name first is how `IN_PROGRESS` goes back
to being a word nobody sets.

**Raising a priority is all-staff; lowering it is managers.** Priority now decides when a
request is late, which makes it consequential in a way it was not. Anyone who smells gas
can make a request urgent — making them find a manager first is how it ends up unrecorded,
the sign-out and roll-taking reasoning. **Quieting** an alarm is a judgement about the
facility's own risk, so it sits where the other judgements do. The rule cannot be expressed
as `requireRole` middleware because whether it applies depends on the body, so it lives in
`setPriority()` with its reasoning rather than being split across a route.

**Closing and reopening are APPENDED to `maintenance_events`, never overwritten.** Two
kinds only — `CLOSED` (carrying which closed state, paired by CHECK) and `REOPENED` — each
with an actor, an instant and a **required non-empty note**. Deliberately not an event log
for everything: starting work and changing priority leave no row, because the facility
asked for a trail of the *consequential* transitions and the audit extension already
records who changed what.

- **`resolvedById`, `resolvedAt` and `resolutionNote` were DROPPED from the request.**
  Reopening used to *clear* them (`services/maintenance.js:76-80`), so a request closed,
  reopened and closed again could only ever describe the second closure — in an app whose
  whole posture is that records are evidence. Keeping them beside the trail would be a
  second copy that can disagree, the same reasoning that dropped
  `ServiceEntry.supersededById`. The current closure is a **read over the trail**
  (`shapeRequest`'s `closure`), never a stored column.
- **The note requirement became a database CHECK.** It lived only in a service function
  until 2026-08-07, which meant any other code path — a script, a future route, a psql
  session — could close a request silently. `maintenance_requests` had **no CHECK, no
  trigger and no REVOKE at all**, unlike every other evidence table.
- **Append-only at both layers, asserted separately** — `REVOKE UPDATE, DELETE` stops the
  app role, a trigger stops a superuser. The module 7 discipline: a test that conflates the
  two proves neither. Note the **request table stays freely updatable**: status, priority
  and ownership are current state, not evidence. Only the trail is frozen.
- `MaintenanceEvent` joins `AUDITED_MODELS`, stays **out** of `SOFT_DELETE_MODELS` (like
  `ScheduleSession` and the check tables — soft-deleting a trail row would hide the fact it
  records), and gets **no RLS**, following `maintenance_requests`: facility configuration,
  gated by role in the API. `reset.js` clears it by TRUNCATE for the same reason as
  `service_entries`.
- **The migration is hand-written because the backfill must run BEFORE the columns are
  dropped.** `prisma migrate dev` would have dropped three columns holding the only record
  of every closure the facility had ever made.

**Still no resident on a request, and that is a decision rather than an omission.** Naming
the resident who reported an issue would make `maintenance_requests` resident data and pull
in RLS policies and the resident block of `AUDITED_MODELS`. Revisit when the portal lets
residents report their own issues — the migration says so at the point it declines to add
policies.

**Photos stay deferred**, blocked on the same object storage as module 1's documents. A
broken thing is the most photographable record in the app, which is why this is named here
rather than left to be noticed.

**`/maintenance` is ONE WORK QUEUE** — a dense filterable table, chosen 2026-08-07 from
three rendered variants. Overdue-first bands and a group-per-apartment list were the
others, and both lost on the same axis: this is a **reference view that gets sorted and
filtered**, not a queue with one urgent act at the top the way `/service` and `/billing`
have. There is no single button to press here — the work is picking the right row — so
promoting a band would be choosing for the reader.

What that costs, accepted knowingly: **urgency is a chip in a column rather than a
position on the page**, so it can be skimmed past. Two things pay for it — the destructive
inset on an overdue row, which is the page's *only* inset, and the figures line, where the
overdue count is the one number in destructive. If the house outgrows a screenful, the
fallback is the bands variant and the figures carry over unchanged.

- **A ROW OPENS.** Clicking the title opens `AppMaintenanceDetailDialog`, and this is the
  most important thing on the page: the table has nowhere to put the **description**,
  which it never showed at all, or the **trail**, which it reduces to "3 entries" — and
  with every action behind a ghost ellipsis, "Edit…" was unfindable. A queue you cannot
  open is a list you can only stare at.
  - **View and edit are ONE modal in two modes**, never two stacked dialogs — CLAUDE.md's
    roll-sheet rule. It also means there is exactly one edit form for a request rather
    than a second that can drift from it. `AppMaintenanceEditDialog` existed for about an
    hour and was folded in here.
  - Anything needing a **note** (resolve, cancel, reopen) or its own **picker** (assign)
    is **emitted**, so the parent closes the detail before opening that one. Same rule:
    never stack.
  - The parent **re-points `active` at the refetched row** after a save. The modal stays
    open, and `load()` replaces the objects wholesale — without the re-sync it sits there
    showing the title you just changed away from.
- **No figure cards.** They were built from the variant C mock and dropped again the same
  day, on request: the description line already states open / overdue / in progress, and
  four cards restating it pushed the queue below the fold. `figures.closedThisMonth`
  stays on the wire — it counts **requests**, not closure events (one closed, reopened
  and closed again inside a month is one thing dealt with), on the **facility** month,
  since a request closed at 9pm ET on the 1st is this month's. A filter chip reaches the
  same rows.
- **Each row carries a visible primary action** before the ellipsis, because everything
  behind a ghost ellipsis made the page read as though it had none. It is **role-aware**,
  since a button that always 403s is worse than no button: *Start work* on unowned open
  work, *Resolve* for a manager on an owned one, *Reopen* for a manager on a closed one,
  and nothing where a tech has no move. The ellipsis still carries the full set.
- **The age column reads against its own target** — "10 days / 7d". A bare age would make
  a 10-day NORMAL and a 10-day LOW look identical when one is late and the other has three
  weeks left. A one-day target prints "24h", not "1d": the facility says urgent is a
  twenty-four hour job, and "1d" beside an age of "3 hours" reads as a date.
- **Filtering is client-side over the one composed read** (`GET /maintenance/house`). The
  figures count the whole house, so a round-trip per chip would let a count and its rows
  disagree for as long as the request took.
- **No clock tick**, for the reason given above.
- `AppMaintenanceList` stays **cards** and is now only the apartment detail page's: a
  second table inside a page that already has a bed table reads as a continuation of the
  first. Both surfaces share `AppMaintenanceActions` and the same dialogs, so they cannot
  disagree about what an action does.
- **`AppMaintenanceRequestDialog` was extracted from `pages/apartments/[id].vue`**, where
  it was written inline and reachable from nowhere else — which is exactly why the
  house-wide queue had no way to file a request at all. It takes `v-model:open` and no
  trigger, per the two-screens rule, and grows an apartment picker only when no
  `apartmentId` is bound (the `AppLedgerEntryDialog` pattern).

**Correcting a request is ALL-STAFF, and only while it is open** (facility, 2026-08-07).
`PATCH /maintenance/:id` carries `title`, `description` and `apartmentId` — identity and
placement, deliberately not status or priority, which have their own routes because they
have their own rules. The tech who typed "smoke alrm" in a hallway fixes it without
finding a manager: filing is all-staff, and so is correcting what you filed. Once the
request is **closed it freezes** with a 409 pointing at Reopen, because a closed request
plus its trail is what an auditor reads — the sign-out shape, fixable in error but only
while nothing has been recorded against it.

- The service is `editRequest()`, **not** `updateRequest()`: that name meant "drive a
  status transition" until this morning, and a reader who half-remembers it would misread
  the guard.
- **An empty patch is a 400**, the `verify-schedule.js` precedent — including when every
  field sent already matches, which is the honest reading of "nothing changed".
- **Moving `apartmentId` is a CORRECTION, not an edit**: it takes the request out of one
  unit's history and puts it in another's, which is exactly why it is available only while
  the request is open. A request filed against the wrong unit and already closed is
  corrected by filing it properly against the right one.

**There is no assign route, deliberately.** "Assign…" calls `POST /:id/start`, which
already takes `{ assignedToId, vendorName, workOrderRef }`, already defaults the assignee
to the actor, and already sits behind `maintenance_in_progress_needs_owner`. A second
endpoint would be a second place for the ownership rule to live.

**The gap this closed, recorded because it is the exact failure this file exists to warn
about:** `vendorName` and `workOrderRef` shipped on 2026-08-06 with **nothing in the UI
able to set them**. `startWork` accepted them and `useMaintenance.startWork` forwarded
them, but the row menu called `startWork(id)` with no body — so the columns whose whole
justification was getting "work order 118" out of a description could be written only by
the seed. Every screen looked plausible. `verify-maintenance.js` now asserts a vendor can
be recorded **and changed**.

Two smaller repairs made with it, both the sort that hide for months:

- **`GET /maintenance` never validated its query.** `req.query.status` went straight into a
  Prisma `where`, so `?status=FOO` came back a **500** where every other bad input in this
  app is a 400. `parseQuery()` in `lib/http.js` is `parseBody`'s twin and exists so a route
  reads honestly about what it validates.
- **`shapeRequest` lived in `services/apartments.js`** and was imported *back* into
  `services/maintenance.js` — the two modules pointing at each other for the shape of a
  thing only one of them owns. The direction is reversed, and `REQUEST_ORDER` is now
  shared, which fixed a second bug underneath it: the list and the apartment detail sorted
  the same collection **two different ways**.

### 11. Fee ledger
**Built (partly).** Not a rent ledger — a balance carries rent, laundry, trips, program
fees and damages, categorised so "what did we bill in laundry last quarter" is answerable
without grepping descriptions.

**A resident owes what has been INVOICED and not yet paid** (facility, 2026-08-07). This
reversed the original rule and it is the most consequential change the ledger has taken, so
the old one is recorded rather than deleted:

```
was:  balance = SUM(charges) − SUM(payments + credits)
now:  balance = SUM(invoice totals, excluding VOID and DRAFT) − SUM(payments)
      pending = SUM(unbilled charges) − SUM(unbilled credits)
```

**The failure that forced it.** Tasha Boone's May, June and July rent were each charged and
each paid — but never invoiced. The Friday sweep bills every unbilled *charge*, and its
guard is `charges + credits > 0`, **not `balance > 0`** — so it billed $2,055 at a resident
who owed $105, demanding three months of rent she had already paid. Excluding payments as
*lines* had never stopped already-paid *charges* from being swept; the two figures could
diverge silently, and on first adoption or after any cash-at-the-desk payment they always
would. Under the new rule they cannot, because the thing that makes money owed is the same
thing that bills it.

Three consequences, each chosen rather than fallen into:

- **A payment with nothing invoiced reads as a CREDIT** — a negative balance that nets
  against the next invoice. Flooring it at zero was considered and rejected: it would hide
  money that was really received.
- **Voiding an invoice removes its demand.** That is why the balance is built from invoice
  *totals* rather than from billed ledger lines — it is what gives a wrong invoice a real
  undo. Its lines stay bound and therefore still never re-bill. The cost, accepted: voiding
  an invoice that carried a CREDIT discards that credit too, so the net effect is that the
  invoice never happened.
- **A DRAFT is in neither figure**, which is a genuine hole rather than a tidy edge: its
  lines are bound so it is not pending, and it was never issued so it is not owed. Hence
  `draftCents` as its own figure, a warning row with a **Send** action in the ledger
  section, and the pre-flight refusal below.

**A keyless server now REFUSES to send** (503, before `draftInvoice` commits) instead of
returning 200 with a local-only draft. The old behaviour was indistinguishable from a real
send at the UI — the lines came back billed and locked, staff got a success toast, and the
invoice would never exist. It happened for real on 2026-08-07, when a merge left
`STRIPE_SECRET_KEY` behind in a worktree (`.env` is gitignored, so the code moved and the
credentials did not). The cost: `verify-ledger.js` can no longer create invoices through the
route, so its arc assertions drive `draftInvoice` directly and promote the draft the way the
seed does — and the route's refusal is asserted on its own.

**A resident in credit is still invoiced the full amount, and that is unsolved.** The credit
lives in our ledger; Stripe has never heard of it. Both send surfaces warn and name the
figure. Pushing the credit to Stripe needs its customer credit balance *and* a decision
about what happens if they pay the full amount anyway — a facility question nobody has been
asked.

Three properties do the work:

- **The balance is derived on every read**, never stored. A stored total is a second source
  of truth, and the day it disagrees with the lines beneath it there is no way to tell which
  is wrong. `verify-ledger.js` asserts no `balance` column exists anywhere — that assertion
  survived the 2026-08-07 reversal untouched, which is the point of it.
- **The table is append-only**, more strictly than `bed_assignments` — no updates at all.
  A mistake is corrected by a new entry with `correctsId` pointing at the one it fixes, and
  a correction must stay inside its own stay. Enforced by trigger and by revoked privilege,
  so it holds against a direct `psql` session, not just against our routes.
- **The amount is always positive**; the sign lives in `type`. A negative charge and a
  payment would be two ways to write the same fact, and every sum would then depend on
  which one whoever typed it happened to pick.

Entries hang off **Stay**, not Resident: a resident who leaves and returns gets a new stay,
and money from the previous episode belongs to that episode.

Any staff member may read a balance — a tech asked "what do I owe" at the door should not
have to find a manager. Only admins and house managers may post to it.

**Charges are unbilled until an invoice is sent (decided 2026-08-02).** Posting a charge
does not bill it. It sits as an unbilled line until someone presses **Send invoice**, which
sweeps every unbilled charge on the stay into one invoice and bills it through Stripe.

This adds a state a ledger line did not have, and it **collides with the append-only rule
above** — marking a line billed is an `UPDATE`, and `ledger_entries` refuses updates by
trigger *and* by revoked privilege. Do not relax that trigger to allow it. The invariant is
worth more than the convenience, and "only this one column, only null → value" is exactly
how an append-only table stops being append-only.

Instead, **the link is its own append-only join table** — `invoice_lines(invoiceId,
ledgerEntryId)`, unique on `ledgerEntryId` so a charge cannot be billed twice. Unbilled then
means *no row in `invoice_lines`*, which is a read, not a mutation, and `ledger_entries`
keeps its no-update guarantee untouched.

- **The balance stays derived.** An `Invoice` may hold a **total**, and that is not a cached
  balance — it is a snapshot of what was billed on the day it was sent, which must *not*
  move when a later correction lands. A sent invoice is evidence, like every other record
  here. `verify-ledger.js` asserts no `balance` column exists; the invoice total is a
  different fact and needs its own assertion saying so, or the next reader will delete it.
- **A correction after invoicing does not edit the invoice.** It is a new ledger entry with
  `correctsId`, and it lands unbilled — so it flows onto the next invoice. Same rule as
  everywhere else: the original stays.
- **Invoices give "overdue" its meaning.** The red dot on the resident record (below) is
  *balance overdue*, and a charge has no due date — only an invoice does. Until invoicing
  exists, "overdue" could only mean "owes anything", which would light red on nearly every
  resident and become noise. Ship the dot with the invoice, not before.

**Built 2026-08-06: invoicing and Stripe.** `Invoice` + `invoice_lines` exactly as
prescribed above, hosted Stripe invoices, and the red dot the section promised.

**The snapshot is now enforced by the DATABASE, not by prose.** `Invoice.totalCents` sits
OUTSIDE the migration's UPDATE grant, so nothing can move it — not a route, not a script,
not a psql session. That is the difference between a snapshot and a cache stated as a
property: a cache is by definition something that gets recomputed, and this one cannot be.
`verify-ledger.js` proves it three ways — behaviourally (a correction moves the balance and
leaves the total alone), by privilege, and by trigger against a superuser.

**Charges AND credits are swept; payments never.** A credit adjusts what is billed and
rides as a negative Stripe line; a payment is money already received, and billing it would
demand it twice — refused by trigger, not merely by the service. **The net must be
positive**: a sweep that comes out at zero or in the resident's favour creates nothing and
leaves the lines to roll onto the next invoice, because Stripe cannot issue a negative
invoice and a $0 one is a document nobody meant to make.

**The sweep is TWO transactions with a durable draft between them**, and that is not an
optimisation. `runInTransaction` opens a Prisma interactive transaction; awaiting Stripe
round-trips inside one pins a pooled connection and trips the timeout, leaving the ledger
right and Stripe holding an invoice nobody recorded. Committing the local draft FIRST means
the lines are billed and un-re-billable from that instant, so a crash before Stripe leaves
a **visible, resumable DRAFT rather than a lost charge** — `POST /invoices/:id/send`
replays it, and `invoice.finalized` heals it unattended. Every Stripe call carries a
**deterministic** idempotency key derived from our own invoice id; a random uuid is a nonce,
not an idempotency key.

**A void is expensive on purpose: its lines never come back.** `invoice_lines` is unique
and append-only, absolutely, so a voided invoice's charges are not re-billable. The fix is
the ledger's own — a CREDIT with `correctsId`, then fresh charges. Making "unbilled" mean
"no row pointing at a *live* invoice" would turn a one-predicate read into a join on status
and let billed-ness silently reverse.

**Invoices are NET 3 DAYS** (facility, 2026-08-07) — due at the **end of the third facility
day**, `INVOICE_NET_DAYS` in `domain/constants.js`, applied by `facilityDueDate()` in
`lib/facilityTime.js`.

**This replaced "due on receipt", which was not a term so much as a bug.** `dueAt` was set
to the moment of sending and `overdue` is derived as `dueAt < now`, so **every invoice this
app ever produced was overdue about a second after it went out**. A separate seven-day
`INVOICE_DOT_GRACE_DAYS` hid that from the record's red dot but never from the ledger's own
label, which is where it was finally noticed — a $20 invoice for Whitfield reading overdue
on arrival. Recorded rather than quietly fixed, because a derived alarm that was wrong for
a week while every screen looked plausible is exactly the failure this file exists to warn
about.

Three details, each load-bearing:

- **The end of the day, not 72 hours on.** "Net 3" is a promise about a *day*: a 2:14 PM
  send and an 11:50 PM send the same evening are due at the end of the same Thursday. That
  is what makes the date in the ledger, the date on the hosted Stripe page and the instant
  `overdue` flips all name the same thing.
- **`due_date` goes to Stripe, never `days_until_due`.** Stripe would otherwise count from
  *its* finalization moment on *its* clock, and the hosted page could name a different date
  than the record.
- **The default lives in `sendInvoice`, not the routes.** Both the per-resident send and the
  Friday run call it, and a default at each call site is two knobs that will disagree about
  what "net 3" means. An explicit `dueAt` on the request still wins.

**`INVOICE_DOT_GRACE_DAYS` and `dotDue` are GONE** rather than set to zero. The red dot is
now exactly `overdue`: three days of terms *is* the grace, and a second grace stacked on top
would be two knobs for one idea with no way to tell which one a screen was showing. **The
`OVERDUE_GRACE_MS` idiom still stands where it was born** — sign-outs, where the deadline is
a promise a resident made and the alarm should lag it. This change removed its only other
user at the time; it is not abandoned, and module 6 took it up again on 2026-08-07 with
`MED_PASS_GRACE_MS`. The family now reads: **fifteen minutes** for a sign-out and an
apartment round, **two hours** for a med pass. The figures differ because what they lag
differs — a promise a resident made, a cadence staff control, and an evening that drifts
with when people get home from work.

And `settled` reads the LEDGER as well as Stripe: a resident who pays $800 cash at the desk
clears the dot even though Stripe never hears, because without that clause the dot burns
forever on somebody who is square and staff learn it lies.

**`occurredAt` is a DATE wearing a DateTime, and it is anchored at facility NOON**
(fixed 2026-08-07). The schema always said it is "the date the line applies to", but a
bare `'2026-08-06'` from the form reached `new Date()` — UTC midnight, which is 8pm on
the *5th* in New York — so an entry a manager dated the 6th was stored as, and read back
as, the 5th. It goes through `facilityDayInstant()` now, and the ledger section renders
every date with `facilityDateOf`. The rule generalised past this module and the reasoning
lives under **Conventions**, with `Stay.intakeAt` and `Stay.expectedDischargeAt`, which
had the identical fault.

**The weekly run is a BUTTON, not a cron** (facility, 2026-08-06). Every Friday staff press
*Generate weekly invoices* — a Quick action on the dashboard, managers only — which bills
every **active** stay whose unbilled lines net positive. Discharged stays are skipped, since
a final invoice for somebody who has left is a deliberate act. The app keeps its no-cron
stance; the honest trade is that forgetting is possible.

`AppWeeklyRunDialog` **previews first and runs second**, and never on open. This is the
app's only bulk money action and it is irreversible in one direction — every line swept is
billed forever, and voiding does not give them back. It has **two states rather than one**,
because a run is per-stay and **partial success is the expected outcome, not an edge case**:
one resident's failure leaves a recoverable draft and must not abort anybody else's invoice.
A dialog that closed on "done" would report that as success. So the second state is a
per-stay list with a tick or a reason, and the count of what did not send.

**The button names what will SEND, not what is ready to bill.** Those differ whenever
somebody has no email, and the button is the promise — "Send 5" that produces 2 teaches
staff to distrust the count.

**A resident with no email cannot be invoiced, and that is ordinary rather than an error.**
Intake requires only a name; Stripe's hosted invoicing requires an email on the Customer.
`canHostInvoice()` is the pure predicate, and it is checked in the **pre-flight, before
`draftInvoice` commits** — which is the whole point of that ordering. Discovered the hard
way: the first version let Stripe answer, and Stripe answers *after* the lines are already
billed, stranding real charges on an invoice that can never send. The dialog refuses for the
same reason and names the residents up front, so the run does not discover a preventable
omission as a list of red rows. `billableStays()` carries `canInvoice` — **the boolean, never
the address**: the preview has to be honest about which stays will fail, and a name beside an
email is more disclosure than the question needs.

**The webhook resolves four collisions**, each forced by this app's own structure:
`express.raw` mounted for its path ABOVE the global JSON parser (Stripe signs the exact
bytes, and body-parser's `req._body` makes the skip structural); mounted ABOVE
`sessionMiddleware`, so no forged cookie can establish an actor and **the signature is the
authentication**, checked before any database access; `runAsSystem()` for the DB actor,
since RLS is fail-closed; and a dormant `stripe@system.soberlife` user for
`recordedById`, because attributing a card payment to whoever sent the invoice would put
their name on money they never touched. **A duplicate returns 200** — `externalRef` stops
the second payment, but a 409 would make Stripe retry that event forever.

**A bug this work uncovered, worth knowing:** `postEntry`'s "that payment has already been
recorded" 409 had been silently broken since the Prisma 7 driver-adapter migration —
`meta.target` is no longer populated, and the constraint name now lives in
`meta.driverAdapterError.cause.originalMessage`. Callers got a 500. `verify-ledger.js` had
not caught it because its assertion used `rejects()`, which only proves *something* threw.
`isUniqueViolationOn()` in `lib/http.js` reads both shapes, and the suite now asserts the
**status**, not just the throw.

**The record's Ledger section is a BAND over a month-grouped history, then the invoices**
(chosen 2026-08-07 from three rendered variants; a bank-style statement and an
invoice-first list were the others). It answers two questions in that order — "what does
this person owe and what do I do about it", then "why" — which is the same hero-over-trail
shape as apartment checks and the same queue-over-progress shape as `/service`, so the rail
reads consistently.

Both rejected variants failed on the domain rather than on looks, and both are worth
knowing before somebody re-proposes them. The **statement** kept the cleanest chronology but
demoted the invoice to a chip at the end of a row, just as an invoice became the thing that
*makes* money owed; its per-month net subtotals also stated a figure that is neither the
balance nor pending. **Invoice-first** was the most faithful to that rule, but payments are
not invoice lines in this model, so it split the story into pending / invoices / payments
and left somebody asking "why $975" to net three blocks in their head — which is precisely
the breakdown this section exists to provide.

- **ONE inset on the pane, and it is the owed block**, which carries the overdue invoice
  numbers and their ages itself. The earlier draft had a destructive box *and* a
  destructive banner under it; two insets on one surface is what stops an inset meaning
  anything, the 2026-08-06 polish-pass rule.
- **Every overdue invoice is named, oldest first** — not just the oldest. Castillo carries
  two, and the old banner showed one, so $650 was simply not on the screen. Oldest first
  matches `overdueByStay`'s own order; the invoice list is newest-first and would otherwise
  lead with the least urgent.
- **Neither figure is hidden at zero.** A missing box reads as a loading state, and staff
  need to see that the answer *is* zero — the one place this section departs from the
  census tile's absence-means-fine rule, because these are labelled figures rather than
  chips.
- **Pending is marked; billed is not.** Once invoicing is routine most lines are billed and
  marking the majority is wallpaper. The Type column is gone for the same reason: the
  amount's sign and colour already say charge from payment.
- **The invoices use native `<details>`**, not a vendored Collapsible — shadcn's is not in
  `ui/`, and `shadcn-vue add` rewrites `main.css` with the Google Fonts imports this file
  forbids. A disclosure is a browser primitive, not the hand-rolled component the
  convention warns about. Expanding one shows **the lines it swept**, the single question
  the flat table could never answer without reading every row.
- **Send names its figure** ("Send invoice · $105.00") and disables with a reason when the
  sweep would refuse — Ferrer's pending nets to a *credit*, and a sweep must come out
  positive.

Two bugs fixed with it: `AppLedger` never called **`onRealtimeChanged(load)`** though every
other rail section does, so a Stripe webhook posting a payment refreshed every screen except
the one where the money moved; and **`draftCents` was fetched and rendered nowhere**, so an
unsent invoice's money was invisible in both figures — the exact hole that field exists to
close. It now gets a warning line with a Send action.

**A pending charge can be REMOVED, and removing is an append** (built 2026-08-07).
`POST /residents/:id/ledger/:entryId/remove`, managers, reason required.

Nothing is deleted and nothing ever will be: `ledger_entries` refuses DELETE by trigger and
by revoked privilege, which is the guarantee the whole module rests on. A removal is an
ordinary reversing **CREDIT** with `correctsId` and the charge's own amount, so both rows
live forever and an auditor sees what was raised, when it was reversed and why. What removal
earns is that the **pair stops being billable** — a charge posted against the wrong resident
is not something they are later asked to look at and query.

- **`removedIds()` in `services/ledger.js` is the ONE place that decides**, and it has to be,
  because pending is computed in **three**: `pendingByStay` (the figures), `pendingFor` (what
  the sweep bills) and `billableStays` (the Friday preview). Miss one and a charge the ledger
  draws as removed still lands on an invoice.
- **The test is exact: same stay, opposite type, SAME amount, both still unbilled.** A partial
  credit is an ordinary adjustment and stays billable — otherwise waiving half a charge would
  silently waive all of it. And since the candidate set is only unbilled rows, a reversal of
  an already-invoiced charge cannot match, which is why **an invoiced charge is refused with
  a 409**: that money has been demanded, and the correction belongs on the next invoice.
- **`pendingByStay` had to stop being a `groupBy`.** Whether a row is removed depends on
  *another row*, which no aggregate can express. It is a `findMany` over the unbilled set,
  which is small by construction.
- **The reversal carries the ORIGINAL's `occurredAt`**, not today's — the apartment-check
  amendment rule, and it also keeps the pair in one month group.
- **The service composes the entry, not the caller.** Amount, type, date and whose ledger it
  lands on are all determined by the charge being reversed; only the reason comes from a
  human. That is module 5's line for when a service may post to the ledger directly.
- **The section draws the pair as ONE struck-through line** with its reason, and hides the
  reversal: it is the same fact stated twice and two rows would read as two events. The
  removed charge is also excluded from its month's `charged` total, or the header would
  state a figure it does not mean.

**Still to build:**

- **The Friday nag** — a Needs-attention row once a Friday has passed with lines pending.
  It is the honest counterweight to having no cron, and it is deliberately *not* "there are
  pending charges", which is true every day and would be exactly the noisy dot this file
  warns about twice. Derivable with no new table: the most recent invoice's `createdAt`
  against the last Friday. **It matters more since 2026-08-07**: pending money is now
  outside the balance, so forgetting to press the button means nobody is shown as owing it.
- **Pushing a resident's credit to Stripe**, so an invoice does not demand money already
  received. Needs Stripe's customer credit balance *and* a facility decision about what
  happens if they pay the full amount anyway. Both send surfaces warn in the meantime.
- **Resident-facing balances**, which is open question 7's remaining half.
*(The default payment term was the last item here. Answered 2026-08-07: **net 3 days**.)*

### 12. Notifications
**Built.** A bell in the app header on every page, showing situations rather than messages:
an unplaced resident, an urgent open maintenance request, a bed out of service.

**There is no Notification table, deliberately.** Everything is derived from current state
on each read, which means it cannot go stale, cannot be dismissed into a lie, and needs no
job to keep it honest — a resident leaves the list the moment they get a bed, not when
somebody remembers to mark it read. The cost is that "unread" cannot mean anything, so the
badge is a live count of open situations. If per-user dismissal is ever wanted, that is a
real table *and* a real decision about whether one person dismissing hides it from everyone.

The badge counts only `action` items. A bed out of service is worth seeing and is not a
number anyone should feel behind on.

**Built: the same numbers on the SIDEBAR (2026-08-08).** Five entries carry a count —
Apartment Checks, Sign-Outs, Travel Passes, Maintenance, Residents — and it is the bell's
own action items for that destination, read from the same `useState`. **No endpoint was
added and no request was added**: `AppNotifications` is rendered by `AppPageHeader` on
every screen, so the bell already fetches on every navigation, and the realtime socket
already refreshes it — so the rail updates live for free. That is a real coupling and
`useNavBadges.js` says so: if the bell ever stops being fetched on every page, the badges
go stale silently.

The count is **absent at zero**, the rule the census tiles and the resident rail already
follow, because a quiet house has to *look* quiet or the colours stop meaning anything on
the day one of them matters. It is **not capped** — the bell caps at `9+` because it is a
fixed-size overlay on an icon button where a wider number shifts the header, and its own
comment says so; a sidebar badge is `absolute` inside a 16rem row and reflows nothing, and
"12 overdue checks" and "9+" are different amounts of alarm. The label truncates before
the badge does.

**Red means a clock has run out; amber means it has not** — and every bell item now
carries a **`severity`** (`critical` / `warning`) saying which. It exists because one kind
cannot be judged from the client: `URGENT_MAINTENANCE` is the union of urgent-and-open
with past-its-own-target, and the item carries neither `priority` nor `reportedAt`, so the
only client-side way to tell them apart was **parsing the `detail` sentence**. It costs
nothing on the server, because `const overdue = requestState(r) === MAINTENANCE_STATE.OVERDUE`
was already computed on the line above for that sentence. This is the dashboard's own
precedent — `attention.urgentMaintenance` carries `state` and `priority` "so the client
need not re-derive the rule", which `verify-maintenance.js` asserts in those words.

`severity` and `level` are **different questions and must not collapse**: `level` says
somebody has to act and drives `actionCount`; `severity` says a clock has run out. An
ACTION item is often only WARNING — nobody is late because a resident has no bed. **Every
item carries it, watch items included**: a field that is sometimes absent is a third state
nobody decided. The words are `facilityStatus()`'s and `SECTION_DOT`'s rather than a third
vocabulary, and every per-kind value is a judgement one of those two had already made —
overdue critical, unplaced warning, `notAccounted` critical.

**Adding it is NOT a module 13 question**, and the reason is worth stating because a
careful reader will reach for the wrong rule: it is a severity flag on a situation the same
item already states in full, and module 12's "the payload is `{ at }` and nothing else"
governs the **`changed` socket**, where RLS does not apply to a fan-out. This is the
authenticated, staff-gated HTTP read, decided per request. `verify-screens.js` runs a
deliberately broad regex over the whole serialised bell payload and is unmoved by it — but
check that regex first if the field is ever renamed.

**Badges are keyed by `kind`, never by an item's own `to`.** `UNHOUSED` links to
`/residents/${id}` — the person, because placing them is the next act — so bucketing by
destination would scatter one badge into a bucket per resident, on routes no nav entry has,
and leave `/residents` bare. **Red wins the moment one item in a bucket is critical**, the
same rule the maintenance detail line follows: amber over a bucket holding a resident
nobody can find would be a lie told in colour, and the count beside it would not correct it.

**Med Pass is deliberately UNBADGED**, recorded so it is not "fixed" later. `MED_PASS_DUE`
is one aggregate item carrying its count inside its title, so a badge built from it would
read `1` beside a bell row saying "3 doses not yet recorded" — two numbers for one fact on
the same screen. Badging it means giving that item a real count field first, which is a
**module 6** decision and not a privacy one: module 13 cleared the shape on 2026-08-07 —
a count and a time, never a name and never a medication. It is the one action-level kind
left out, and the five badges sum to `actionCount` minus exactly it, which is a cheap
browser check that the rail and the bell agree.

**Built: realtime, as an invalidation socket that carries nothing.** Socket.IO on the
API's HTTP server (`server/src/lib/realtime.js`), one event — `changed` — whose payload is
`{ at: <timestamp> }` and **nothing else**: no ids, no names, no entity types. Clients
respond by refetching what they already show over the authenticated HTTP API, so what a
device may see is decided per request by RLS, RBAC and the audit log, exactly as without
the socket. Every screen updates live — the census board, the roster, the status pill,
the bell — and the "no Notification table" decision above still stands: nothing is stored,
nothing is pushed, nothing can be unread.

How it hangs together:

- **Emission is a response hook, not per-route calls**: any successful non-GET outside
  `/auth` broadcasts (app-level middleware in `app.js`), so future modules are covered by
  construction. Bursts coalesce server-side (75ms) and client-side (200ms debounce).
- **The handshake is staff-only** — an explicit {ADMIN, HOUSE_MANAGER, STAFF} allowlist,
  not `!== RESIDENT` (server `STAFF_ROLE` includes RESIDENT). Logout disconnects that
  session's sockets; out-of-process revocation (create-user.js, reseed) leaves a socket
  connected until its next handshake, which is acceptable *because* it carries nothing.
- **Idle expiry slides on HTTP refetches only, never on socket traffic** — a connected but
  untouched shared device still times out, which is the point of the timeout.
- The admin client is `useRealtime()` + `plugins/realtime.client.js` (socket for the life
  of the signed-in session); pages opt their `load()` in with one `onRealtimeChanged(load)`
  line, and refreshes never re-blank what they update.

**The empty payload is a hard rule, not a default.** The original warning stands for
whoever adds the first data-carrying event — a resident signs out, a Stripe payment lands:

- **A socket is a fan-out, and RLS does not apply to it.** Every subscriber gets what the
  server pushes, so the authorisation the policies do per-query has to be re-done per
  subscriber, per event. This is the single most likely place to leak resident data in the
  next year of this project. Adding a payload field beyond `at` is that project — a
  storage, authorization and who-receives-what design, not an extra property on an emit.
- Derived items answer *what is true now*; events answer *what just happened*. An event
  has to persist to survive a reconnect, and only an event can meaningfully be unread —
  that is the change that would reverse the no-Notification-table decision.
- Who receives what is a role question with no default: a tech does not need to know a
  payment landed, and an admin probably does not need every sign-out.
- Stripe webhooks arrive server-to-server and have to be verified before they become
  events — an unverified webhook is an unauthenticated write to a resident's balance.

**The Stripe webhook is built (module 11), and the empty payload survived it.** A paid
invoice writes a PAYMENT row and then broadcasts the same `{ at }` as every other write;
every screen refetches over the authenticated HTTP API and sees what RLS and RBAC allow
it to see. **No payment detail is pushed** — that would be the data-carrying event this
section warns about, and it is still unbuilt.

Two orderings in `app.js` are load-bearing and easy to undo:

- **The signature is verified BEFORE any database access and before `runAsSystem`.** The
  signature *is* the authentication — there is no session on that route. A bad signature
  is a **400 with zero rows written**, never a retry invitation.
- The raw-body parser is mounted on `/stripe/webhook` **immediately above** the global
  `express.json`, and the router **above `sessionMiddleware`**. Body-parser sets
  `req._body`, so the global parser skips it by construction. `express.json({ verify })`
  was rejected: it would buffer every request body in the process to serve one route.

### 13. Global search
**Built.** A header field with `⌘K`, searching residents and apartments.

Treated as the largest deliberate disclosure surface in the app, because it is: under
42 CFR Part 2, confirming that a **named person** is in this facility *is* the disclosure.
So the endpoint is staff-only (never `RESIDENT`), refuses queries under two characters so it
cannot be walked a letter at a time to enumerate the roster, caps results, and returns only
the fields the roster already shows the same person — no date of birth, no SSN fragment, no
balance, no notes.

**The query string is never logged, audited, echoed in an error, or put in a URL.** It is
somebody's name. The audit trail records which resident ids came back, which is the access
that actually happened.

**Nothing from modules 5 or 6 goes in the bell without a separate think.** A name against
"has no bed" is operational. A name against a screen result is a disclosure to whoever is
standing behind the person holding the phone.

**Both thinks have now happened, and they came out differently — which is the rule working
rather than an inconsistency.** Module 5 (2026-08-06): **nothing at all**, not a name, not a
count, not a link, and it is structural rather than intended since `GET /residents/:id`
carries no screens block. Module 6 (2026-08-07): **a count and a time, never a name and
never a medication** — `MED_PASS_DUE`, "3 doses not yet recorded · 3:00 PM med pass ·
2 residents". The distinction that decided it: a count says *the round has not been run*,
which is operational and true of the house rather than of a person; a name beside a
medication is a clinical fact about somebody, read over a shoulder in a hallway. Where a med
item would have had to name a resident to be useful, it does not exist — which is why it
counts only DUE doses, the ones anybody can still act on, and not the missed ones.

### 14. Dashboard
**Built (2026-08-05).** The landing page at `/`, replacing the census board as home —
a deliberate reversal of the earlier decision, made knowingly: the census keeps its
domain name, its own nav entry and its whole board at `/census`, one tap away, and the
status pill and logo still link to `/` because the pill's figure (overdue / unplaced) is
exactly what the dashboard's panels answer.

**Relaid 2026-08-08, chosen from three rendered variants.** The shape is now: greeting
header → **unaccounted band** → **strip of four status cards** → **Needs attention** full
width → a **three-panel foot** (Today · Signed out · Outstanding balances). The greeting
still reads on the **facility clock**, never the browser's, with **Quick actions** on the
right; `AppTodaySchedule` is a **plain list** since 2026-08-08 (FullCalendar's one-day list
view before that, and a rolling 7-day list before *that*, narrowed 2026-08-06), and the whole
day still shows including sessions already over
— the panel answers "what is today's schedule", and un-taken rolls are the queue's business.

**What was wrong, measured rather than felt.** The old 1.55 : 1 split gave the right column
one content-sized panel beside three stacked ones, so **the schedule ended at y 480 while
the left column ran to y 1018 — 537px of nothing, over half the grid**. Needs attention was
422px, about 40% of a 1,041px page that scrolled at every desktop height. And two of the
three cards restated the panel directly beneath them: "2 signed out · 1 overdue" sat above
the Signed out panel, "$1,625.00 outstanding" above Outstanding balances.

**The result: 892px in a 900px viewport at 1440 — the page fits, alarm band and all**, down
from 1,041. Attention is 230px, down from 422, **with nothing hidden and no cap changed**.
The foot's three panels end within **78px** of each other.

**THREE PANELS IN THE FOOT, AND THE NUMBER WAS MEASURED.** Two-up left Today 138px short of
the panels beside it; stretching the cells to fix that put **140px of blank inside the Today
card**, which reads as a bug rather than as breathing room. Three panels at their natural
heights agree to within 78px with no stretch at all, which is why `items-start` is still
there — nothing needs to stretch when the heights already match. The rejected two-up is
recorded so it is not re-proposed as new.

**Needs attention goes TWO-UP at `xl`**, and the row shape, the priority order, the caps,
the overflow rows, the situations badge and the single amber dot are all **unchanged**.
Priority reads left-to-right then down, which is the natural order — the rows' *sequence* is
what makes this a queue rather than a list, so it is preserved rather than gridded into a
serpentine (which is what sank the rejected "bands, no columns" variant). The cost, taken
knowingly: an odd number of situations leaves a hole at the end of the last row.

**Two situation classes that were on the wire from the start and rendered NOWHERE are now
rendered** — `attention.notAccounted` and `attention.checksOverdue`. Both already fed the
bell at `severity: CRITICAL`, and module 1 calls unaccounted-for "the record's loudest
fact", so the screen that greets every unlock was silent about the loudest thing the
facility can be told. **No server change was needed**, which is why `verify-dashboard.js`
passes **unchanged** — that unchanged suite is the evidence the whole relay was client-side.

- **The band is people, and is NEVER capped** — the cap rule already refuses to hide one:
  "hiding either is hiding a person or a hazard." Sorted longest-missing-first, the same
  rule `checksOverdue.since` follows.
- **The round is a FIGURE, not rows**, with a named first apartment and an "and N more"
  tail — navigation, the roll-overflow rule applied to a box. Strictly less than `/checks`
  shows, which is the one place this layout trades detail for height.
- **The figure always means one thing**: apartments past their round. It is deliberately not
  overloaded with the unaccounted count — two facts sharing one number is how a reader
  learns to distrust it. **The last-checked time is stated only when ONE apartment is
  overdue**; beside "and 2 more" it would read as describing all of them.
- **`lastCheckAt` is legitimately NULL** for an apartment nobody has walked (module 4: "an
  apartment never checked reads OVERDUE, not blank"), so it is branched on, never defaulted
  into a formatter.
- **Membership is NOT re-derived client-side.** `/checks` re-filters its own full apartment
  list; this page receives the already-filtered subset, so re-filtering could only shorten it
  and would let the two screens disagree. Only the elapsed label ticks.
- **THE ROUND BOX IS THE ONE PLACE THIS PAGE STATES A POSITIVE** — "Everyone accounted for".
  The absence of an alarm is not the same as its presence, and on the screen that greets
  every unlock at a recovery residence, saying so is worth a box.

**THE ONE INSET MOVED, and that is a deliberate reversal.** It was on the overdue sign-out
row since 2026-08-06; it is now on the unaccounted band. Module 1 settles the tie in its own
words: *"where anything ever needs a single answer, unaccounted-for outranks overdue,
because one is a person nobody can find and the other is money."* The sign-out row keeps its
destructive badge and its red due time, so it **loses styling and no information** — the
same trade the balances panel and the overdue-pass row each made when they considered the
inset and declined it. The page still carries **exactly one**, and that is now asserted in
the browser by counting computed `box-shadow`s rather than being merely aspirational.

**`AppStatCard` was extracted** — three inline copies of the same ~25-line class string, and
the strip needed a fourth. The sub-line is a **slot**, not a string prop, because every one
of them carries markup. It was landed as its own commit, verified pixel-identical first, so
the layout commit had a clean baseline.

**The balances card and panel link is role-aware, and this was a defect.** Both pointed at
`/residents`; `/billing` shipped 2026-08-07, the day *after* the rule that a card "should
take you where you act on its number". It is **not a swap**: `/billing` is manager-gated and
its route guard bounces a tech, so `balancesTo` is `canManage ? '/billing' : '/residents'`.

**`quietDay` gained the two new clauses**, which was also a defect waiting to happen: it read
only attention/signedOut/balances, so a house with every queue empty but one apartment past
its round would have printed "Nothing needs attention" directly above a box saying otherwise
— the self-contradiction module 15 records for the "$150 waiting / Send $250" card.

**One read, `GET /dashboard`, composed entirely from the modules' own derivations** —
`listSignOuts`, `unhousedWithOptions`, `cohortCapacity`, `scheduleWindow`,
`urgentOpenWhere()` (extracted to `services/maintenance.js` so the bell and this page
share one knob), `balancesByStay`. A dashboard row and its source page cannot disagree,
and `verify-dashboard.js` asserts the agreement endpoint by endpoint. It is also the
most-refetched read in the app — every realtime invalidation lands here — so every piece
stays one bounded query. **Do not add per-resident query loops to it.**

Decisions with teeth, each chosen explicitly:

- **All-staff, never RESIDENT** — the bell's posture. Names appear (it is a work queue,
  like `/service`); nothing clinical ever does. This page greets every unlock, which
  makes it the app's densest ambient-disclosure surface — module 13's warning applies
  here with the most force.
- **An overdue row carries its destination** (the bell rule: whoever acts needs to know
  where to start looking) — decided against the census tile's never-a-destination rule,
  knowingly, because this is a work queue and not a wall board.
- **"Outstanding" balances: a positive derived balance on an active stay — and the
  panel KEEPS that name now that invoicing exists** (2026-08-07). Its meaning
  **sharpened for free** the same day, when a balance became invoiced-and-due: the panel
  now lists money the facility has actually asked for, not charges nobody has billed.
  It needed no edit, which is what keeping the derivation in `services/ledger.js` buys.
  It is still the complete list; overdue is a property of *some rows*, not a different list. The card
  total is computed as the sum of the rows beneath it, in the same read, so the two
  cannot drift, and `overdueCents` is the same sum over the overdue rows — the
  beds-free card's split treatment, because a bare total hides the difference between
  owing and being late, which is the whole judgement. `lastPaymentAt` rides along
  because owing $500 having paid last week is a different situation from owing $500 in
  silence.

  **Two keys sort it: overdue first, then largest.** "Owes the most" and "is past due"
  are different urgencies and only the second has a date attached. In the seed the same
  resident happens to be both, so `verify-dashboard.js` asserts the *rule* rather than
  the resulting order — the one-key assertion that was here before passed by coincidence
  after the sort changed, which is how a sort assertion rots.

  An overdue row takes the Signed-out panel's destructive **badge** and deliberately
  **not its inset rule**: the 2026-08-06 polish pass left exactly one inset on this page
  so that inset means something. Considered and declined, recorded so it is not "fixed".

  `overdueByStay()` is ONE grouped query shared with the resident record, so the panel
  and the rail's red dot cannot disagree about who is overdue — module 14's no-per-
  resident-loops rule, and `verify-dashboard.js` asserts the agreement.

  **Instants shown as dates go through `facilityDateOf()`, never `isoDate()`.** Both
  `lastPaymentAt` and the maintenance `reportedAt` were UTC-sliced, so a payment taken at
  the desk after 8pm ET rendered as "last payment **Tomorrow**" — a payment that has not
  happened yet. CLAUDE.md's own rule ("`isoDate()` is fine for dates, wrong for times"),
  and this is what it looks like when it is broken.
- **Needs attention is the bell's action items as a panel** — unhoused, rolls due,
  urgent maintenance — in the pill's priority order, each row tagged with its kind.
  **Minus overdue sign-outs** (the Signed out panel is directly beneath; one situation
  should not be two rows) and **minus community service** (left out by request — the
  verification queue stays on `/service` and the rail's amber dot).
  **An OVERDUE TRAVEL PASS is a row here (2026-08-08), and it leads the panel** — the
  one addition since, and it is deliberately not the exclusion above. Overdue sign-outs
  are left out because the Signed out panel sits directly beneath and one situation
  should not be two rows; there is no passes panel on this page, so without this row a
  resident nobody can find is invisible on the screen that greets every unlock. It
  carries the destination, like the sign-out rows, and is **never capped** — hiding a
  person is what the cap rule already refuses to do. It takes a **destructive badge and
  no inset**, the balances panel's own trade, so this page keeps exactly one inset.
  `overduePasses()` is shared with the bell, and `verify-passes.js` asserts the two name
  the same passes.
  **Rolls are the one kind capped — at THREE (2026-08-06)**, with an overflow row
  ("30 more rolls due → Schedule") carrying the rest. A house that has never taken a
  roll owes a fortnight × two cohorts of them, and thirty roll rows bury the one urgent
  repair. Unhoused residents and **URGENT** repairs always render **in full**: both are
  structurally small, and hiding either is hiding a person or a hazard. **The badge
  counts SITUATIONS, not rendered rows** — the capped rolls are still true, and the
  overflow row is navigation.
  **A correction to this paragraph (2026-08-08):** it said "urgent repairs" render in full
  and meant every repair in the panel, which stopped being true on 2026-08-07 when the
  bell's union grew a merely-*aged* arm. `AGED_REPAIRS_SHOWN = 3` caps that tail with its
  own overflow row; a request at **URGENT priority** still always renders, hazard-first.
  The rule did not change — the prose was describing half of it.
- **The beds-free card shows one figure with the cohort split beside it** ("2 · 1 men,
  1 women") — the bare total alone would hide one side full while the other has room,
  which is the exact failure `cohortCapacity()`'s per-cohort shape exists to prevent.
- **`upcoming` crosses the wire in band form**, `{ shared, lanes }` like `GET /schedule`
  and produced by the same merge — there is still no server endpoint returning a flat
  schedule list. `AppTodaySchedule` concatenates the provably-disjoint bands
  client-side (the board's own sanctioned pattern) and renders them as a **plain list**
  (2026-08-08, by request — a five-row read-only list is not what a calendar library is
  for, and this is the app's most-refetched page). Read-only; a row navigates to
  `/schedule`.
  **IT MUST SORT.** That is the one thing FullCalendar was quietly doing for us:
  `shared` and `lanes` are each ordered, but concatenating them interleaves two ordered
  runs into an unordered one, so a 7:30 women's session would print above a 9:00 shared
  house meeting purely because of which band it came from. It sorts on the wall-clock
  string, which is safe *because* `'HH:MM'` is zero-padded — lexical order is
  chronological order and no Date is constructed.
- **Overdue is re-derived client-side on a 30-second tick** against `signedOut` rows
  the server sends un-filtered — the census pattern, so a resident crosses the grace
  window without a refetch. The needsRoll queue does NOT get the schedule board's 60s
  refetch tick here; the 30s tick's `refreshStatus()` nudge and the realtime socket
  cover this page, and a roll going missed surfaces on the next load — the dashboard
  is glanced at far more often than the board, so staleness is bounded by usage.
- **The one `scheduleWindow({ days: 1 })` call feeds both** the roll queue (its
  fortnight lookback is independent of the span) and the Today list — one expander, by
  construction.
- **Quick actions open the existing shared dialogs**, never copies: `AppSignOutDialog`
  and `AppResidentIntake` were refactored to `v-model:open` (module 1's rule — two
  screens open them now), and `AppServiceEntryDialog` / `AppLedgerEntryDialog` grew an
  **optional in-form resident picker** used only when no `residentId` is bound. Intake
  and Record payment are hidden (not disabled) for techs; the server refuses either
  regardless.

**Polish pass (2026-08-06), two rules worth keeping:** the attention panel carries ONE
amber signal — a dot on its eyebrow — and its rows are quiet; an inset rule on every row
made urgency read as wallpaper, so the destructive inset on an overdue sign-out card is
now the only inset on the page, which is what gives it meaning. And the status cards are LINKS to the page that
explains their figure — a card that names a number should take you where you act on it.
**There are FOUR since 2026-08-08** (hourly round, sign-outs, census, money), and the money
one now resolves per role: it pointed at `/residents` for a year after `/billing` became
the page that explains it. One trap **that used to be hit** in
`AppTodaySchedule`: pulse's stylesheets are unlayered and beat Tailwind utilities, so
overriding its nowrap on event titles took an inline style rather than a class. That is
no longer live on this page — the plain list wraps its titles with an ordinary class —
but **the trap itself still applies anywhere FullCalendar renders**, which is `/schedule`.
The title still wraps rather than truncating, and for the original reason: this panel is a
third of the foot's width and the whole width of a phone row, and a clipped group name is
worse than a second line.

**Deliberately excluded, so they are not "added later" casually:** an occupancy-over-time
trend (needs replaying `bed_assignments` history per day — a report, not a page read) and
a true attendance rate (whether EXCUSED counts is facility policy nobody has set; the
board's counts stay counts).

### 15. Billing
**Built (2026-08-07).** `/billing`, **managers and admins only** — the first page in the app
whose *read* is manager-gated, and the reason a new client-side guard exists (below).

Billing had no home. The act that actually bills the facility was a **Quick action in a
dropdown on the dashboard**, and the rest was scattered — outstanding balances on the
dashboard, invoices per-resident on the record, nothing anywhere answering "who is past due"
across residents. That mattered more once a balance became invoiced-and-due: pending money
sits outside the balance, so an unpressed button means nobody shows as owing it.

**RUN-FIRST** (chosen from three rendered framings; a collections-first chase list and a
filterable invoice ledger were the others). This app has no cron: the facility is billed when
a human presses a button, so what is ready to bill is the first band and the act is the point
of the page. Bands: figures → **Ready to bill** with the send → **Past due** → recent
invoices. The Quick action moved here; the dashboard's balances panel stays and links across.

- **`GET /billing` is one composed read**, the `/census`, `/service`, `/dashboard` pattern,
  built entirely from derivations that already exist — `billableStays`, `overdueInvoices`,
  `balancesByStay`, `pendingByStay`, `draftByStay`. A band cannot disagree with the resident
  record it came from.
- **`billableStays()` was NOT changed, deliberately.** It is the list the weekly run loops
  over, so admitting net≤0 stays would make it attempt sends that must fail. Stays that nets
  to a credit come back as a separate `skipped` array; stays with **no email** are already in
  `ready` carrying `canInvoice: false`, and the screen groups them from that flag. Two sources
  for "will not send" would be two lists to keep in step.
- **`overdueInvoices()` returns EVERY overdue invoice, not one per stay** — the difference
  from `overdueByStay()`, which keeps the oldest because the dashboard and the rail's dot each
  need a single answer. A chase list needs them all: Castillo carries two, and the second is
  $650 nobody was being shown. Both derive through the same `invoiceStatus()`.
- **"Waiting to be billed" is the sum of the POSITIVE stays, not the facility net** — the
  same number the Send button offers, by construction. It shipped as the net, so one
  resident sitting on a $100 credit made the card read "$150 waiting" above a button
  offering to send "$250": both right, and looking like a contradiction, because a sweep is
  per stay and hers is never billed at all. The credit is stated beside the figure instead
  of being netted out of it. This is the same trap the Friday nag avoids by carrying a
  count, and the card walked straight into it — the two figures are now asserted equal.
  Where they legitimately differ is a stay with no email, and the line under the button
  names exactly who.
- **The past-due figure is a SPLIT of outstanding, never a sum of invoice totals.** Summing
  the documents produced "$1,625 outstanding, $1,950 past due" — impossible on its face,
  because a part-paid $650 invoice leaves less than $650 owed. It is the balance of stays
  carrying an overdue invoice, the dashboard card's own rule, and `verify-billing.js` asserts
  both the agreement and that it cannot exceed outstanding.
- **`GET /invoices/billable` was tightened to managers** with it. All-staff was an oversight
  rather than a decision — only manager UI ever called it. **The per-resident ledger read
  stays all-staff and is untouched**: a tech asked "what do I owe" at the door still answers
  it without finding a manager. That is one resident; this is the facility's books.
- **`AppWeeklyRunDialog` gained `confirmOnly`** rather than being copied — the screen *is* the
  preview, and a confirm that repeats it is noise. The `AppEventForm` layout-prop precedent.
  Its second state still earns its keep: partial success is the expected outcome of a per-stay
  run, and that report has nowhere else to go.

**The Friday nag is built** — module 11's "still to build", and the honest counterweight to
having no cron. Derived, no new table: it fires when money is pending anywhere **and** no
invoice has been created since the most recent Friday on the facility calendar. Deliberately
*not* "there are pending charges", which is true every day. It carries a **count of residents,
never an amount** — the screen's own pending figure is the facility net (which includes
somebody sitting on a credit), and a second money figure under the same word is how a row and
the card above it come to look like they disagree.

It appears on `/billing` and as a row in the **dashboard's Needs-attention panel**, and
**deliberately not in the bell**: the bell is glanced at on a shared phone by techs, who
cannot open this screen at all, and an item nobody looking at it can act on is noise. The
panel is already not identical to the bell — overdue sign-outs and community service were
both removed from it — so a dashboard-only row has precedent. `verify-billing.js` asserts the
bell stays clean.

**A new client guard, and why it did not exist before.** `definePageMeta({ roles })`, read by
`middleware/auth.global.js`, redirects a role that may not open a page. Every earlier
manager-gated page (`/apartments`, `/staff`) has an **all-staff GET** behind it and gates only
the writes, so a tech typing the URL simply got a page. `/billing` is the first whose read is
refused, and without the guard a tech typing it got a **500 from the rejected fetch** — a
crash where a redirect belongs. Presentation only, as ever: the API refusing the data is the
protection, and the suite asserts that separately.

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

**Payment processors are third parties, and this is the sharpest case.** The mere fact that
someone is in a SUD program is protected. A Stripe Customer named "Ruben Castillo" with an
email address, attached to an account belonging to a sober living facility, discloses
exactly that — to Stripe, to anyone with access to that dashboard, and to any subprocessor
downstream. It is a disclosure whether or not a card is ever charged.

**That paragraph has not changed and does not need to. What changed is the PERMISSION.**
This section used to say "send no resident name, email, phone or date of birth" and
"whether any of this is permissible without written consent is a question for whoever
advises the facility." It said that because consent was **unresolved**. On **2026-08-06 the
facility's advisor cleared name and email**, and module 11 was built on that clearance. The
rule is rewritten rather than quietly broken, and it is dated so it can be revisited if the
advice changes.

**Permitted to Stripe, and nothing beyond it:**

- The resident's **legal name** and **email address**, on a Stripe Customer — one per
  person, created lazily on their first invoice, never at intake.
- **Opaque ids in metadata** — `invoiceId`, `stayId`, `residentId`, `ledgerEntryId` — built
  by `invoiceMetadata()` so the surface is one function rather than a habit.
- **Amounts**, and **line labels from a fixed category mapping** (`STRIPE_LINE_LABEL`).

**Forbidden, absolutely:**

- **Date of birth, SSN fragment, phone.** Phone is on this list as a DECISION, not an
  omission: nothing in invoicing needs it, so it does not go.
- **Anything clinical** — a screen result, a substance, a medication, an apartment or bed,
  a program or phase.
- **Any free text a human typed.** This is the rule that keeps the surface bounded: a
  ledger description is unreviewed prose a manager entered in a hallway and can say
  anything at all, so **it never crosses**. Line text comes from the category map, and
  there is deliberately no memo, footer or custom-description field anywhere in the flow.
  `LAB_FEE` reads **"Testing fee"** — the clearance covers identity, not clinical
  inference, and "Lab confirmation fee" on a sober living facility's account narrows to
  *this person had a non-negative screen*. `verify-ledger.js` asserts the whole mapping.

**Still open, deliberately:**

- **Stripe does not email the resident.** `STRIPE_EMAIL_INVOICES` is `false`, because the
  clearance covers Stripe *holding* an address, not Stripe *sending mail to it* — an
  unannounced invoice email discloses to their mailbox provider and to whoever else reads
  that inbox. Staff hand over the hosted URL. One sentence to the advisor settles it; the
  flag is already there.
- The facility's own legal name on the **statement descriptor** is a disclosure to whoever
  reads the resident's bank statement. Still unasked.

**The Stripe MCP server is a developer's tool for the sandbox, not something the server
calls.** The API talks to Stripe through the SDK with a key from `server/.env`. A Node
process cannot reach MCP, so do not try.

**Georgia.** The specific licensing or certification body and the retention period are
still unverified — see open question 1. Until they are, the app's posture is deliberately
conservative: retain everything, hard-delete nothing.

---

## Tech stack

**JavaScript, not TypeScript.** See Conventions for how we get the safety TS would have
given us.

| Folder | What it is |
|---|---|
| `server/` | Node + Express API. **Prisma 7** over **PostgreSQL**. The only thing that touches the database. |
| `admin/` | Staff-facing app — admin, house manager, tech. Nuxt 4 + Nuxt UI v4 + Tailwind v4. |
| `client/` | Resident-facing app. Same stack. Empty until the staff side is real. |

- **shadcn-vue** for components, themed by the `a6OmWiie` preset — style `reka-luma`,
  teal primary, Inter body with Geist Sans headings, Lucide icons. Components are
  **vendored** into `admin/app/components/ui/` — we own them, so restyling means editing
  the component rather than overriding it.
- **Tailwind CSS v4** via `@tailwindcss/vite`.
- **Both light and dark themes.** The earlier decision to defer dark mode is reversed —
  the preset defines both.

### UI rules

The preset owns colour and type. What it does not decide, and we do:

- **44px minimum tap target on touch**, baked into the vendored source of `button`,
  `input`, `select` and `sidebar`. It is **conditional**, not absolute: the preset's own
  scale applies under a mouse, and the floor comes in when either `max-md` (the phone,
  which is also the breakpoint that swaps the sidebar for a sheet) or `pointer-coarse`
  (a tablet or touch laptop) holds. Neither alone is enough — `max-md` misses the tablet,
  and `pointer-coarse` is invisible when you test mobile by resizing a desktop browser.

  It was unconditional first, and that was wrong twice over: thirteen sidebar items at
  44px pushed the nav past a laptop viewport, and 44px chrome read as oversized to the two
  roles who work in this app on a desktop all day. The rule was always about the hallway;
  making it about every device was the mistake.

  `Switch` is the exception that shows the better shape — a 20px track with a 44px hit
  area from an `::after` inset. Where a control can keep a small visual and a large
  target, prefer that over growing the control. Note `getBoundingClientRect()`
  under-reports it.
- **`--success` and `--warning` were added** to the preset's `@theme`, in both themes.
  shadcn ships only `destructive`, and this domain has to keep a refusal visually distinct
  from a dilute and from a positive — see modules 5 and 6.
- **No monospace anywhere.** Column alignment comes from `tabular-nums`, which is what was
  actually wanted; the face itself resolved to whatever the device happened to have.
- **Fonts are self-hosted** by `@nuxt/fonts`. The preset ships Google Fonts CDN `@import`s,
  which would put a third-party request on every page load.
- **Row actions follow `AppBedTable`**: a trailing column, a ghost ellipsis
  `DropdownMenuTrigger`, `DropdownMenuContent align="end"`, and **one dialog per table**
  driven by a row ref — never one dialog per row. Dialogs are siblings of the table, never
  inside a cell.
- **Dialogs that more than one screen opens take `v-model:open` and take no trigger of
  their own** — `AppResidentBedDialog`, `AppResidentDischargeDialog`,
  `AppResidentReleaseBedDialog`, `AppLedgerEntryDialog`, `AppEventCreateDialog`. A component
  that owns its trigger can only be opened where it is rendered, which is what forced these
  out of the record page. They take scalars (`residentId`, `residentName`, …), not a resident
  object: the roster row and the record page hold different shapes.
- **A WIDE dialog is a desktop affordance, and needs a below-`md` answer, not a media query
  that hopes.** `AppEventCreateDialog` is two columns at `sm:max-w-5xl`; below `md` the
  callers route to the equivalent page instead of opening it (`useMediaQuery('(min-width:
  768px)')`). Width only, deliberately not `pointer: coarse` as well — the 44px tap floor
  cares whether a finger is pointing, but two columns only care whether they fit, so a touch
  laptop at 1440 should still get the dialog.
- **One form, two shells.** When a form has both a dialog and a page, the fields and every
  rule live in ONE component that takes a `layout` prop (`AppEventForm`, `'columns'` |
  `'stacked'`); the shells supply only a heading and a footer, through a slot. Two copies is
  how the dialog comes to confirm a destructive narrowing that the page performs silently.
  The route stays a live deep link at every width regardless — the schedule calendar has
  always navigated with `?date=&time=&minutes=`.
- **A table column list must not be an array of strings filtered with `filter(Boolean)`** —
  an empty-string header for an actions column is falsy and gets silently dropped, leaving
  a `th` short and the empty-state `colspan` off by one. Use objects with a `key`.
- **The app header is shell, not page — and it no longer names the page.** It carries
  search, one status figure, and the bell. **Every page states its own name** in an
  `AppPageHeading` rendered by `AppPage`, so a screen cannot be nameless by omission.
- **The way back out of a detail page is the heading's `back` prop**, not a breadcrumb.
  It belongs with the title it returns from, not in chrome shared by every screen.
- **The status pill shows ONE figure**, chosen server-side: the most urgent true thing,
  falling back to beds free when the house is quiet. Three counts side by side is a
  dashboard, and it competes with the bell. Counts only, never names — that is what makes
  it safe on every screen regardless of who is behind the phone.
- **Forms use `AppField`**, not shadcn's `Form` — that one is vee-validate based and we
  validate server-side with zod. **Toasts go through `useNotify()`**, not `vue-sonner`
  directly. **Page headers go through `AppPageHeader`.** That header has no bottom rule and
  the page title renders at the breadcrumb's own size and weight — it is distinguished from
  its ancestors by colour alone. It is still the `<h1>`; that is semantics, not a licence to
  style it as a heading.
- Table rows 48px, `px-3` cells. Wide tables scroll inside their own `overflow-x-auto`
  container; the page never scrolls sideways. Mobile-first for anything a tech touches.
- The shell follows shadcn's **sidebar-08** block. Three deliberate deviations: no
  collapsible submenus, because we have no second-level navigation and inventing one to
  fill the shape would be IA written to match a template; breadcrumb ancestors stay visible
  below `md`, because they replaced a back arrow and a phone is where the way back matters
  most; and **`SidebarMenuBadge` is CENTRED rather than offset by button size**. shadcn's
  `peer-data-[size=default]/menu-button:top-1.5` assumes its own 36px button, and ours is
  `max-md:h-11 pointer-coarse:h-11` under the 44px rule above — so the stock offset sat the
  badge 6px high in a 44px row, on exactly the device that floor exists for. **This is the
  second-order cost of that deviation**, and the place to look for the next one. Centring is
  height-agnostic, so it cannot rot the next time a height moves.
- **The icon rail loses the badge, so it gets a dot.** `SidebarMenuBadge` is
  `group-data-[collapsible=icon]:hidden` and a number does not fit a 32px button — but
  collapsing is a **persisted cookie choice**, so "we lose the signal when collapsed" really
  means the two desktop roles collapse the rail once and never see it again. `AppNavBadge`
  renders both: the chip when expanded, a dot when collapsed, and **the count survives in
  the button's tooltip**, which shadcn already shows only when collapsed. Same trade
  `AppResidentRail` makes to keep its dots on the sheet trigger below `md`. The dot is a
  **sibling of `SidebarMenuButton`**, never inside the link — the button is `overflow-hidden`
  and would clip it — and it cannot appear in the mobile sheet by construction, because
  `data-collapsible` is only set on the desktop branch of `Sidebar.vue`.

Six things that will trip you up:

1. **`shadcn-vue add` rewrites `main.css` every time**, silently restoring the Google Fonts
   CDN `@import`s — a third-party request on every page load, which this file forbids. It is
   not the `--overwrite` flag; a plain `add` does it too. **Always** run
   `git checkout admin/app/assets/css/main.css` after adding a component, or at minimum
   `git diff` it before committing.
2. **`components:` in `nuxt.config.js` needs `extensions: ['vue']`** on the `ui` folder, or
   Nuxt registers each `index.ts` barrel as a component too.
3. **Composables exported from a component barrel are not auto-imported** — `useSidebar` has
   to be imported explicitly. Nuxt only scans `composables/` and `utils/`.
4. **Reka's `Select` rejects an empty-string item value**; it reserves `''` for "cleared".
   Use a sentinel like `'all'` and map it to `undefined` at the query boundary.
5. **`AppPageHeader`'s `md:rounded-t-2xl` has to match `SidebarInset`'s corner**, or the
   card shows as a sliver outside the header. It is `2xl`, not the `xl` shadcn ships — the
   preset restyled `SidebarInset`.
6. **tailwind-merge does not resolve a conflict across DIFFERENT variant modifiers.**
   `cn('peer-hover/menu-button:text-sidebar-accent-foreground', 'text-destructive')` keeps
   **both**, and the peer variant also wins on specificity — `(0,3,0)` against `(0,1,0)` —
   whatever the source order, so a plain override silently loses in exactly the states you
   look at the thing in. Overriding a vendored `peer-*` / `group-*` utility takes the **same
   modifier**, or it does not take at all. This is why `AppNavBadge` re-states
   `peer-hover/menu-button:` and `peer-data-active/menu-button:` for its colour, and it is
   verifiable: with the same modifier the base rule is *resolved away* and no longer appears
   in the rendered class list.
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
- **Use `process.env.DATABASE_URL` there, not `@prisma/config`'s `env()`.** `env()` throws
  the moment the config is *loaded*, and the config is loaded for every command — including
  `prisma generate`, which needs no datasource at all (only `generate --sql` does). That
  eager throw made `npm install` fail on a fresh clone once `postinstall` ran generate,
  before anyone had copied `.env`. `process.env` is also the shape `prisma init` emits.
  Commands that really need the URL still fail, with a clearer message, at the point they
  need it.
- **`postinstall` runs `prisma generate`.** The client is generated into `src/generated/`,
  which is gitignored, so without the hook a fresh clone gets `ERR_MODULE_NOT_FOUND` from
  the first script it runs.
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
  CLAUDE.md
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
- **Multi-table writes go through `runInTransaction()`** from `db/client.js`. The RLS
  extension opens a transaction per operation and Prisma cannot nest them, so an outer
  `prisma.$transaction` would fail — this helper opens one, sets the actor context once,
  and every operation inside reuses it. Intake is the motivating case.
- **Always import the extended client from `db/client.js`, never a bare
  `new PrismaClient()`.** A bare client bypasses the soft-delete and audit extensions,
  which is exactly the failure mode they exist to prevent. `$queryRaw` deserves the same
  scrutiny, for the same reason.
- **Money is integer cents**, everywhere — database, API and UI. Dollars are parsed to
  cents once, on the server, so one rounding rule applies to everyone; `12.10 * 100` in
  JavaScript is `1209.9999…`, and a cent lost per charge is a ledger nobody can reconcile.
- Domain constants (`SCREEN_RESULT`, `DISCHARGE_TYPE`, `MED_LOG_STATUS`) live in
  `server/src/domain/` and are copied into the frontends, not imported across folders.
  They must match the `enum` blocks in `schema.prisma`.

### Row-level security — enabled

The database-layer backstop on the app's most important privacy rule: residents must never
enumerate other residents. Express middleware is still primary; this is what holds when a
route is added without the right guard.

**Two connections, and the distinction matters.**

| | Role | Used by |
|---|---|---|
| `DATABASE_URL` | `soberlife` — owner, superuser | `prisma migrate`, `seed.js`, `verify-constraints.js` |
| `APP_DATABASE_URL` | `soberlife_app` — no ownership, `NOSUPERUSER`, `NOBYPASSRLS` | the running API |

A **superuser bypasses RLS entirely, even with `FORCE`**, so the app connecting as the
owner would have made the policies decorative. `db/client.js` refuses to start in
production without `APP_DATABASE_URL` and warns loudly in development.

Setup: `npx prisma migrate deploy` creates the role (without a password — a credential in a
migration is a credential in git), then `APP_DB_PASSWORD=... npm run db:app-role` grants it
LOGIN and verifies it cannot bypass RLS.

**Policies are fail-closed.** They read `app.actor_kind` / `app.resident_id`; with nothing
set, `current_setting` returns NULL, every predicate is false, and queries return nothing.
Forgetting to set context loses you data — it never leaks it.

**Context is per-operation.** Connections are pooled, so the settings are scoped with
`set_config(..., local => true)` inside a transaction; a plain `SET` would leak one
request's identity onto whatever request got that connection next. Requests get context
from `middleware/dbActor.js` (derived from the verified session, never from the request);
scripts must wrap their work in `runAsSystem()`.

Three things that are easy to get wrong here, all of which we did get wrong first:

- **Extension order.** Prisma applies the FIRST-declared extension as the OUTERMOST hook.
  RLS must be declared LAST, because it re-issues the operation on a bare transaction
  client — declared first it bypassed every extension beneath it, silently turning soft
  deletes on resident data into HARD deletes and dropping their audit rows.
- **Every model needs context, not just RLS-protected ones.** A query on `Apartment` that
  includes beds → assignments reaches `bed_assignments`, which is policy-protected.
- **`PrismaPromise` is lazy.** `runAsSystem(() => prisma.x.findMany())` executes outside
  the context; it must be `runAsSystem(async () => await prisma.x.findMany())`.

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
sessions** when the password changes.

Accounts made this way **survive a reseed** — `seed.js` removes only the three
`@facility.test` demo logins and leaves everything else alone. That is also why its reset
uses a mix of TRUNCATE and DELETE rather than one TRUNCATE CASCADE: `users.residentId`
references `residents`, so cascading from there would take the accounts with it.

Two verification suites, both run against a live database:

- `npm run verify:constraints` — 20 assertions on the database-level invariants
- `node scripts/verify-auth.js` — 15 assertions on the login/session/audit flow
- `node scripts/verify-apartments.js` — 32 assertions on apartments, beds and
  maintenance, including the admin/manager field split, the rules the database
  cannot enforce, and the remove/restore arc. Its six maintenance assertions cover
  the apartment-detail path and stay; the module's own arc is the suite below
- `node scripts/verify-maintenance.js` — **64 assertions** on the repair lifecycle.
  The target rule is proved **with no database** at 23h/25h URGENT, 6d/8d NORMAL and
  29d/31d LOW, plus a closed request staying CLOSED however old — without which every
  resolved request in the facility's history would light up. The **union is proved in
  both directions**, which is the pair the design rests on: an urgent request two hours
  old is *not* overdue and reaches the bell anyway, an aged NORMAL one *is* overdue and
  reaches it, a young NORMAL one is in neither, and the bell's set equals urgent-open ∪
  overdue exactly — so no third rule crept in. The bell and the dashboard are then
  asserted to name the same requests. `IN_PROGRESS` with no owner is refused by the
  CHECK, **and separately with a NULL and a blank vendor name** — issue #1's hole
  wearing a maintenance costume. Closing is refused blank at the route *and* at the
  CHECK, a REOPENED row carrying a `closedAs` is refused, and the arc that motivated the
  whole table gets four: close → reopen → close leaves **three events**, the **first
  closure is still readable**, the trail reads oldest-first, and `closure` resolves to
  the **latest**. "The trail shows the latest closure" would pass with the first one
  destroyed, which is exactly what the old columns did — the row count going *up* is the
  guarantee. Append-only is asserted at **both layers separately** (privilege for the app
  role, trigger for a superuser), the raise/lower priority split is proved in all four
  combinations, `?status=FOO` is a **400 not a 500**, and the list and the apartment page
  are asserted to return the **same order**. **Nine cover the edit surface**: a tech
  correcting an open request; an empty patch as a 400; a missing apartment as a 404; a
  moved request landing on the new apartment **and leaving the old** (the pair, because
  "it appears in the new place" passes while it is still counted in the old); a closed
  request refusing an edit **with its title read back unchanged**, since "it was refused"
  passes if the route is merely broken; a vendor and work order **recorded and then
  changed**, which is the regression that motivated the whole item; and
  `closedThisMonth` moving by exactly one on a close **and** staying a window rather than
  a count of everything ever closed. Posts requests and closes them — reseed after
- `node scripts/verify-residents.js` — 47 assertions on the roster, intake,
  bed moves, discharge, the SSN read restriction, the notification bell, and search.
  Includes the cohort-mismatch 409 and a tech's 403 on bed assignment — the pair the
  census board's free-tile placement rests on, and the intake and expected-out dates
  coming back on the day they were typed rather than the day before
- `node scripts/verify-ledger.js` — **72 assertions** on derived balances, invoicing, the
  append-only guards, dollar-to-cent parsing, and processor-reference idempotency.
  Includes the invoice **snapshot proved three ways**, a duplicate webhook returning
  **200 with one PAYMENT**, overdue flipping on a cash payment **with no write to the
  invoice**, `stripeLineLabel` exhaustively over the whole enum, and the rule that a
  resident with **no email cannot be invoiced through Stripe** — refused before anything
  is billed, so no draft is stranded. Two pin `occurredAt` on the facility clock, in
  **both** directions, since a regression to the naive parse still passes a one-way check.
  **Eight pin the invoiced-and-due rule**, and each in both directions because the cheap
  half of every one of them passes under the old arithmetic too: posting a charge moves
  **pending only**; invoicing moves it into the balance **to the cent**; a stay nobody has
  invoiced owes **zero, not a hidden pile**; a correction after invoicing lands pending and
  leaves the balance **alone**; **voiding drops the balance by exactly the invoice total**
  while its lines do *not* return to pending; a **DRAFT is in neither figure** and is
  reported on its own; a payment with nothing invoiced reads as a **credit**; and it
  **nets against the next invoice**. Plus the keyless send **refused with nothing billed** —
  which is also why the arc drives `draftInvoice` directly rather than the route.
  **The suite STUBS the key rather than depending on the environment lacking one**
  (fixed 2026-08-07). `scripts/lib/no-stripe.js` is imported FIRST — before
  `src/app.js`, the as-owner.js ordering rule, because `src/lib/stripe.js` reads
  `STRIPE_SECRET_KEY` once at module load and freezes the answer into
  `stripeEnabled()`. It sets the variable to `''` rather than deleting it, so a later
  `import 'dotenv/config'` further down the graph cannot quietly put the real key back.

  **The note that used to sit here was wrong in two ways, and both are worth keeping**
  because they are how a "known environmental failure" hid a real one. It said the
  keyless-refusal assertion merely fails on a machine with a key and "the other 71 pass".
  It did not: the send **succeeded**, which **billed the stay's pending lines**, so the
  next step — which needs something unbilled — threw `There is nothing unbilled on this
  stay` and **the suite died there**, with roughly sixty assertions never running. And
  because the send was real, every run created a **live invoice against a seeded resident
  in the Stripe sandbox**. A failure documented as cosmetic was costing most of the
  suite's coverage and touching an external service. All **72 now run and pass with a key
  present or absent**.
  **Five pin the net-3 term**, led by the regression that motivated it: an invoice sent
  today is **not overdue**; the due date is the end of the **third facility day** and two
  sends on that day share it whatever the hour, both proved on fixed instants so no DST
  week can flake them; a real invoice stores that date rather than the send moment; and
  **no `dotDue` rides on the wire**, which would otherwise let the client key on something
  the server stopped computing. **Ten cover removing a pending charge**, and the important
  ones are the negatives: **both rows SURVIVE** (the row count goes *up*, which is the
  append-only guarantee — "pending dropped" alone would pass if the charge had really been
  deleted), the **balance does not move**, the **Friday run counts neither half**, and a
  reason, a second removal, an **invoiced** charge and a **tech** are each refused
- `node scripts/verify-census.js` — 12 assertions on the census read: derived occupancy,
  the figures row, the three tile states, and the staff-only gate
- `node scripts/verify-realtime.js` — 14 assertions on the invalidation socket: the
  handshake refuses anonymous, garbage and RESIDENT sessions; the payload is `{at}` and
  nothing else; reads, failures and `/auth` stay silent; bursts coalesce; logout
  disconnects. Leaves a probe account and maintenance requests behind — reseed after.
- `node scripts/verify-signouts.js` — 34 assertions on the sign-out flow: wall-clock
  interpretation in the facility timezone, one-open-per-stay, the grace window, census
  presence (and that it never carries a destination), the pill's critical branch, the
  bell item clearing itself on return, and returned records refusing deletion.
- `node scripts/verify-schedule.js` — **99 assertions** on the schedule. On the resident record:
  marks coming back **newest-session-first**, and `hasActiveStay` being **true for an active
  resident and false for a discharged one** — the pair the section's three empty states rest
  on. **Eight cover the 2026-08-08 reshape**, and two are the ones that matter: no `upcoming`
  key rides on the payload at all — a KEY-PRESENCE check, because a re-added `upcoming: []`
  would pass a length check while quietly restoring the coupling — and the summary's total
  **exceeds a one-row page**, which is what catches a client counting the rows it happens to
  hold. Plus two keyset pages that neither overlap nor break the ordering, a cursor page
  omitting the summary, a malformed cursor as a 400, and a resident with no marks getting **no
  summary** rather than a 0-of-0 bar. The old board-vs-record "one expander" assertion is
  **gone rather than broken**: the record expands nothing now, so no second read is left to
  disagree — the dashboard still carries that property, asserted in `verify-dashboard.js`. **Thirty on editing,
  moving and deleting:** identity and the roster editable *with* attendance recorded and the
  taken roll untouched, all five shape fields refused once anything is recorded, `endsOn`
  refused below the last recorded date, **the merged shared card surviving an in-place timing
  edit**, a removed attendee's mark surviving as `offRoster` and the same resident addable
  again, a roster edit unable to smuggle a cohort change past the freeze, an empty patch
  refused, ONCE clearing its weekdays and closing its window; then the move arc — refused when
  nothing is recorded, refused before a recorded date, the old series closing the day before
  the new one opens, provenance recorded, the roster carried minus anyone discharged,
  **every previously-taken session still reachable and still TAKEN afterwards**, no second
  move; and a **cancelled-but-unmarked** event refused for both delete and shape, proving the
  two guards share one predicate. Plus eleven on the
  per-date reschedule: a tech refused, **both occurrences carrying the override**, **the
  merged card surviving the move** (the one that catches a half-written fan-out, because
  `band.js` splits a divergent pair into two lane cards), only that date moving, and refusals
  for an uncovered date, a taken roll, a past session and a cancelled one. Plus: one flat payload
  becoming two occurrences with **identical timing**, one combined roster splitting onto the
  right occurrence by each resident's own cohort, a both-cohorts event rendering **once** in
  the shared band and in neither lane, **a shared session staying MISSED when only one side
  is stamped** (the unanimity rule, pinned via raw Prisma because the API cannot produce it),
  one roll routing each mark to its own cohort's session and stamping both, cohort integrity
  through the API *and* at the composite foreign key, one-off and weekly expansion, `endsOn`
  and a future `startsOn`, the window clamp, **a weekly 6pm reading 6:00 PM on both sides of
  a DST boundary**, lazy materialization and the refusal of a date the rule does not cover, a
  tech taking a roll but not setting the schedule, a discharge dropping someone off future
  sessions with no write, and a resident on nothing getting an empty schedule rather than
  their cohort's
- `node scripts/verify-service.js` — 40 assertions on community service: the pace rule
  without a database (day-1 clean, first month grace, whole-month steps, capped at target,
  no target means no dot), pending hours excluded from the total, the app role refused by
  **privilege** and a superuser refused by the **trigger** — asserted separately — a column
  in no whitelist immutable by default, an amendment as a pure INSERT that cannot fork or
  cross a stay, a void as zero minutes, no stored total column anywhere, a tech who may
  log and verify but not set a target, and a **NULL amendment reason refused by the
  database** — the assertion that would have caught issue #1, which a CHECK passing on
  NULL let through until 2026-08-06
- `node scripts/verify-billing.js` — **20 assertions** on the billing screen's one read:
  a **tech refused** `/billing` *and* `/invoices/billable` while still reading one
  resident's ledger (the gate that matters, since hiding the nav link is not one); every
  band equal to its source, with `skipped` provably disjoint from `ready` so the run cannot
  bill what the screen disclaims; **past due carrying a resident twice**, oldest first, and
  agreeing with that resident's own record; the past-due figure equal to the dashboard's
  split and **never exceeding outstanding**; and the Friday nag in **both directions** —
  firing with money pending and no invoice since Friday, and CLEARING the moment one is
  created, since "it fired" passes even if it always fires. Also asserts the **bell stays
  clean**. Sends an invoice locally — reseed after.
- `node scripts/verify-dashboard.js` — 22 assertions on the landing page's one read:
  staff-gated, capacity per cohort with no combined total, `upcoming` in band form over
  a one-day window with nothing shared also in a lane, every queue equal to its source
  endpoint (sign-outs
  with matching overdue flags and destinations, the census's unhoused, the board's roll
  queue, open URGENT maintenance), balances summing to their own card and agreeing with
  the roster, a probe payment moving the total on the next read, and a probe sign-out
  surfacing and being cleaned up again. **24 since 2026-08-07** — the two extra pin the
  balances panel's overdue half: the card's split summing to its own rows, and the
  resident record agreeing about who is overdue (one grouped query behind both). The
  sort assertion now asserts the two-key **rule**, because the one-key version kept
  passing by coincidence after the sort changed. Posts a $1 payment — reseed after.
- `node scripts/verify-checks.js` — **69 assertions** on the hourly round: the staff gate, the
  board derived from the latest check (95 minutes OVERDUE, most-overdue-first, the missed
  bucket derived from absence, the amended marker), a roster that pre-accounts open
  sign-outs and never carries a destination, roster-completeness 409s (missing, extra,
  duplicated), PRESENT-needs-note at the route AND the DB CHECK (including the NULL-note
  and NULL-reason CHECK holes — a CHECK passes on NULL, and the assertions pin the
  explicit IS NOT NULL guards), NOT_FOUND refused for a signed-out resident and PRESENT
  accepted for one found on site, the rolling alarm at 76 vs 74 minutes, both bell items
  appearing and clearing themselves, the amendment arc (reason required, same line set,
  re-validated as of the original instant, checkedAt carried verbatim, original preserved,
  no fork, cross-apartment refused by trigger), append-only on both tables asserted at
  both layers (app role by privilege, superuser by trigger), RLS (headers invisible to
  residents, lines scoped to their own stay), and audit rows carrying ids only. **Fourteen
  on the resident record**: the record flagging a resident unaccounted while (and only
  while) the bell does — set AND cleared, proving the shared derivation; the section hero
  matching the record payload; the trail newest-first pinned; an amended check appearing
  once, marked; the date filter returning one whole facility day and an empty day being
  empty rather than an error; keyset pages that neither overlap nor break the ordering;
  the hero riding on page one only; malformed date and cursor each a 400; and a
  discharged resident getting the no-active-stay payload while their record still opens.
  **Three cover the signed-out line's purpose**, and the negative is the load-bearing one:
  the purpose of the covering sign-out shows; **no destination appears anywhere in the
  serialised payload** (a regex over the whole response, the `verify-screens.js` idiom, so a
  `destination` added to the shape later fails rather than sliding past); and a sign-out with
  **no purpose comes back null** rather than erroring — the common case, and the one a naive
  implementation crashes on. The seed exercises both states without being asked to: Ocampo's
  sign-out carries a purpose and Boone's deliberately does not.
  Posts checks — reseed after. **It passes at every hour of the day** (fixed 2026-08-08),
  and the fix is worth knowing because the diagnosis in this file was wrong for two days.

  This used to fail two assertions before about 2 AM, recorded here as a "known fragility
  of the suite". It was not the suite: **the SEED was writing its rounds into yesterday.**
  The women's checks sat at `nowMs - k * HOUR`, and the day log is bounded by facility
  midnight, so before 2 AM every one of them landed in the previous day and today's log had
  nothing to show. The seed now places them at *today's* elapsed hours — the last one in
  hour `H-2`, which is 60–180 minutes back whatever the minute and so always past the
  alarm, with hour `H-1` deliberately empty as the missed bucket.

  **What remains is a property of the clock, not a defect, and the suite states it rather
  than failing.** A MISSED bucket is an ELAPSED hour with no check; at 00:30 the facility
  day is one hour old and that hour is still running, so no such hour exists and no seeding
  can invent one. Between midnight and 2 AM the two bucket assertions print an explicit
  skip naming the reason and the run is **67/0**; from 2 AM it is **69/0**. What IS asserted
  at every hour is the universal half — the current hour is never called missed, because it
  has not elapsed — so the rule still has a test in the window where its sibling cannot run.

  Verified by running the suite in zones where it is currently 00:53, 01:53, 02:53, 10:54
  and 22:54, which exercises the real code path rather than a stubbed clock.
- `node scripts/verify-screens.js` — 66 assertions on drug screening: the staff gate; the
  queue carrying **no outcome fields and no outcome values at all**, so the reveal is a
  boundary rather than a curtain; a positive without substances, a negative with them, and
  a specimen with no seal number each refused; a REFUSAL landing NOT_OFFERED because there
  is nothing to send; collection in the future and three days back both refused; the
  reveal being audited; the decision arc (nothing to decide on a negative, no lab named,
  a tech recording the election, one decision only) with **exactly one $50 LAB_FEE posted,
  the balance moving by exactly the fee, and no result in the description**; the lab's
  restricted vocabulary; **the cup surviving a contradicting lab**, `contradicted` and
  `refundDue` derived; **no money moving on a lab result**, and the review clearing itself
  once a manager posts the credit by hand; the amendment arc including **the arc carrying
  forward** and the fee not posting twice; both append-only layers asserted separately
  (privilege and trigger, plus a column in no whitelist immutable by default, the arc
  refusing to run backwards, and a superseded screen refusing to transition); RLS in both
  directions; the record section and its absent `current.screens`; and **the negative
  assertion that the bell and dashboard payloads contain nothing from module 5**. Posts
  screens and a ledger charge — reseed after.
  **One trap worth knowing:** that negative is a regex over the *whole serialised*
  payload (`/screen|POSITIVE|DILUTE|…/`), and since 2026-08-07 an overdue maintenance
  request reaches the same payload — so a repair titled "screen door" fails a privacy
  assertion with nothing actually wrong. The seed says "storm door" for exactly this
  reason. Rename the data, never loosen the regex: its breadth is what catches an
  `attention.screensPending` somebody adds later.
- `node scripts/verify-meds.js` — **68 assertions** on the med pass. Six prove the
  two-hour grace with **no database at all**, on fixed instants so no DST week and no time
  of day can flake them: 119 minutes past is DUE, 121 is MISSED, a future dose is UPCOMING,
  and **a recorded log beats the clock** — without that last one a dose given late flips
  back to MISSED on the next refresh. Two pin the wall-clock rule in **both** directions:
  20:00 reads 20:00 in October *and* November, **and the two are different UTC instants**,
  since a conversion that did nothing would pass the first half alone. The privacy boundary
  is asserted against the **serialised** board payload rather than a key list, so a
  `medicationName` somebody adds to a pass row later fails it — with the matching positive
  that the sheet *does* name medications and the board *does* name residents, because a
  queue nobody can read is not the goal. **MISSED is proved unstorable twice**, at the route
  and by counting the enum's members. `REFUSED` with no note is refused by the CHECK **and
  separately with an explicitly NULL note** — issue #1's hole again, and the assertion that
  would catch it. Append-only is asserted at **both layers separately** (privilege for the
  app role, trigger for a superuser), alongside the positive that a **medication** is still
  editable, which is the whole current-state/evidence split. The amendment arc gets six,
  led by the **row count going UP** — "the amendment shows" passes with the original
  destroyed, which is the failure the pattern exists to prevent — plus the slot and the
  snapshot carried verbatim, no forked chain, and a cross-medication amendment refused by
  the trigger. Deleting a medication with doses is refused **and it is then read back to
  prove it was not removed anyway**; ending one before a recorded dose is refused. A
  discharge drops future doses from the board **with nothing deleted to achieve it**. The
  bell is asserted in both directions — it **fires** while a dose is due, names no resident
  and no medication, and **clears itself** once every due dose is recorded. RLS is asserted
  both ways: another resident's doses are invisible **and their own are readable**, because
  "sees nothing" passes just as well when the policy denies everything.
  **One trap, and it cost a false failure here:** the RLS assertions must be
  `async () => await prisma…`, never `() => prisma…`. A `PrismaPromise` is lazy, so returned
  unawaited it escapes the resident context and runs under the suite's ambient
  `runAsSystem` — every row comes back and it reads as a leak while testing nothing.
  **Three pin the discontinuation day**, and the pair is the point: a medication ended on
  a day it already has a dose is accepted, that recorded dose is **KEPT**, and the one
  never given is **GONE**. Either half alone passes a broken filter — "the unrecorded dose
  is gone" passes if every dose was dropped, and "the recorded one survives" passes if
  nothing was filtered at all.
  Posts doses and medications — reseed after.
- `node scripts/verify-passes.js` — **55 assertions** on travel passes, and the suite
  **owns its own away fixture** because the seed deliberately has none: a pass outranks a
  sign-out in `presenceOf()`, so seeding an active one on any housed resident silently
  rewrote a fixture verify-signouts or verify-checks depends on. Eligibility is proved
  **with no database** in both directions — Orientation refused however long somebody has
  been here, Phase 1 refused at **day 89** and allowed at **day 90** (the boundary is
  inclusive), a null policy refused, a discharged stay refused — and then proved to be the
  rule actually in force, through a **route** 409 naming the day count. **The overdue bound
  gets its own pair**, because it is the one a reader gets backwards: a pass five hours past
  its return **still covers** the resident, and an approved pass for next week does **not**
  cover today. **The bed is asserted on the ROW** — same assignment id, same `startedAt`,
  still open — since an assignment ended and re-created would leave the census looking
  identical while rewriting permanent history. The arc is proved once and forwards
  (approved-then-denied refused, withdrawal after review refused, and the trigger refusing
  to run it backwards for a superuser); a denial with no reason is refused **at the route
  and by the CHECK**; append-only is asserted at **both layers separately**, including a
  column in no whitelist being immutable by default. Then the four integrations, each with
  the negative that a cheap assertion would miss: the tile still **names her** and counts
  `passOverdue` while carrying **no destination**, and the bell's item **does** carry one;
  the round accepts `ON_PASS`, refuses `NOT_FOUND`, and the bell does **not** then call her
  unaccounted for; the dashboard's own row appears **and the bell and the panel are asserted
  to name exactly the same passes**, which is the point of `overduePasses()` being one
  helper — and that pair lives here rather than in `verify-dashboard.js` for the same
  fixture reason; her doses vanish from the board, asserted **after** proving she has a
  medication at all so it cannot pass vacuously; every roll flags `onPass` and the
  attendance count **does not move**, which is the whole no-writing-ahead decision. Finally
  the return clears the bell and the tile, a second return is refused, and RLS is asserted
  both ways plus a resident's write refused. Posts a check and reviews passes — reseed
  after.
- `npm run verify:rls` — 28 assertions proving a resident actor cannot read, count or
  write another resident's rows — including their ledger and sign-outs — and that the
  app role cannot bypass the policies

**`verify:constraints` TRUNCATEs as it runs**, so reseed before running the auth suite or
its users will be gone and every login assertion fails:

```
npm run verify:constraints && node scripts/seed.js \
  && node scripts/verify-auth.js && node scripts/seed.js \
  && node scripts/verify-apartments.js && node scripts/seed.js \
  && node scripts/verify-residents.js && node scripts/seed.js \
  && node scripts/verify-ledger.js && node scripts/seed.js \
  && node scripts/verify-census.js \
  && node scripts/verify-realtime.js && node scripts/seed.js \
  && node scripts/verify-signouts.js && node scripts/seed.js \
  && node scripts/verify-schedule.js && node scripts/seed.js \
  && node scripts/verify-service.js && node scripts/seed.js \
  && node scripts/verify-maintenance.js && node scripts/seed.js \
  && node scripts/verify-dashboard.js && node scripts/seed.js \
  && node scripts/verify-checks.js && node scripts/seed.js \
  && node scripts/verify-screens.js && node scripts/seed.js \
  && node scripts/verify-meds.js && node scripts/seed.js \
  && node scripts/verify-passes.js && node scripts/seed.js \
  && npm run verify:rls
```

`verify-apartments.js` creates test apartments and leaves them behind, so finish with a
seed to get back to a clean facility.

**If someone is actively using the dev database, do not reseed it under them.** The
suites run fine against a scratch database in the same container — the RLS migration's
role creation is idempotent, so this is safe to repeat:

```
docker exec soberlife-pg psql -U soberlife -c 'CREATE DATABASE soberlife_verify'
export DATABASE_URL="postgresql://soberlife:soberlife@localhost:5432/soberlife_verify?schema=public"
export APP_DATABASE_URL="postgresql://soberlife_app:soberlife-app-dev@localhost:5432/soberlife_verify?schema=public"
npx prisma migrate deploy && node scripts/seed.js   # then run the suites as above
```

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
  One exception: the vendored shadcn components in `admin/app/components/ui/` are
  TypeScript, because shadcn's sidebar does not survive the CLI's TS→JS conversion. That is
  library code we own rather than code we write, and Nuxt compiles it without extra setup.
- **Domain states are frozen constant objects, never loose strings.** Without TS enums
  this is how we keep `'refused'` from silently becoming `'Refused'` in one code path:

  ```js
  export const SCREEN_RESULT = Object.freeze({
    NEGATIVE: 'NEGATIVE',
    POSITIVE: 'POSITIVE',
    REFUSAL:  'REFUSAL',
    DILUTE:   'DILUTE',
    PENDING:  'PENDING',
  })
  ```

  **VALUES ARE UPPERCASE, matching the Prisma enum.** This block used to illustrate them
  in lowercase, which contradicted all fourteen real constants and all fourteen `enum`
  blocks — an error in the durable record, corrected 2026-08-06 when module 5 made
  `SCREEN_RESULT` real. A future implementer copying the old sample verbatim would have
  produced a constant that silently disagreed with the schema, which is precisely the
  failure the frozen-constant rule exists to prevent.

  Declare them as `enum` blocks in `schema.prisma` so Prisma and Postgres both reject
  anything off-list. With no compiler, the schema is the type system — and that extends
  to **arrays**: module 5's `substances` is a `Substance[]` enum array rather than free
  text, so the database rejects an off-list drug the same way it rejects an off-list
  result. Note Prisma emits a scalar list as a **nullable column with no default**, so
  such columns need `SET NOT NULL` + `SET DEFAULT ARRAY[]::"T"[]` in the migration —
  otherwise `cardinality(NULL)` is NULL and any CHECK about them passes on NULL, which is
  issue #1's hole wearing an array costume.
- **Validate every request body at the route boundary** (Zod or similar). Nothing reaches
  a query unvalidated — this replaces what TS would have caught at compile time.
- **JSDoc on domain functions and query modules.** Enough for editor autocomplete on
  `Resident`, `Bed`, `ScreenResult` shapes without adopting TS.
- Timezone-aware timestamps stored as UTC. Curfews, passes, and med windows are
  time-critical and cross midnight, so every scheduled local time is read against the
  facility timezone — a **single value in `FACILITY_TIMEZONE`**, not a column. The
  facility is one site; if a second site in another zone ever opens, that is the
  assumption to revisit. `server/src/lib/facilityTime.js` (wall-clock → UTC and back,
  no timezone library) is the one place that interprets it; the admin app mirrors the
  display half in `utils/facilityTime.js` as a copied constant. The older `isoDate()`
  UTC-slice helper is fine for dates, wrong for times — do not reuse it for anything
  with a clock.

  **Which helper a date takes is decided by the COLUMN TYPE, and getting it backwards
  is a real bug in both directions** (swept 2026-08-07). A **`@db.Date`** column —
  `ServiceEntry.workedOn`, `Stay.sobrietyDate`, `Resident.dateOfBirth` — keeps only the
  date part, so it takes **`isoDate`** and `facilityDateOf` would shift it a day the
  wrong way. A **`DateTime` instant** — `intakeAt`, `dischargedAt`, `outAt`,
  `occurredAt`, `dueAt`, `BedAssignment.startedAt` — takes **`facilityDateOf`**, because
  `isoDate` slices UTC and anything recorded after 8pm ET then renders as tomorrow.

  **Several DateTime columns are calendar DATES, and those need the facility clock on
  the WRITE side too.** `LedgerEntry.occurredAt`, `Stay.intakeAt` and
  `Stay.expectedDischargeAt` are all fed a bare `'YYYY-MM-DD'` from a form, and
  `new Date('2026-08-06')` is UTC midnight — 8pm on the **5th** here — so a date
  somebody typed was stored, and read back, as the day before.
  **`facilityDayInstant()`** in `lib/facilityTime.js` is the one knob: a bare date is
  anchored at facility **noon**, a real instant passes through untouched. Noon is the
  load-bearing part rather than an arbitrary pick — it is far enough from *either*
  midnight that the stored instant lands on the intended day whether it is later read on
  the facility clock or sliced in UTC, which is what stops this drifting back the next
  time somebody reaches for the wrong display helper. It is **not** for a `@db.Date`
  column, which is unambiguous already.

  Two form prefills had the same fault and wrote it into the database rather than merely
  showing it: `AppLedgerEntryDialog` and `AppResidentIntake` both defaulted their date
  box to `new Date().toISOString().slice(0, 10)`, so after 8pm ET they offered
  **tomorrow** — and in the ledger's case Save wrote that date into a table nothing can
  update. Both now use `facilityDateNow()`. The admin's `facilityDateOf` returns **null
  for null**, deliberately matching `isoDate`'s contract, because it replaced it at call
  sites rendering `?? '—'`.

  **The value is `America/New_York`** — the facility is in Georgia. It was
  `America/Chicago` first and every time in the app read an hour early. Note the zone
  lives in **five** places, only three of them env-driven: `server/.env`,
  `server/.env.example`, the `?? ` fallbacks in `lib/facilityTime.js` and
  `scripts/verify-signouts.js`, and the **hardcoded copy** in the admin app's
  `utils/facilityTime.js`. Changing the environment alone leaves the client an hour
  off, which is what makes this worth stating rather than deriving.
- Mobile-first CSS for anything a tech touches in the hallway.
- Seed data should look like a real facility: several apartments across both cohorts, a
  full census, one overdue sign-out, and travel passes in every state.

  **But a fixture belongs to whichever suite proves the hardest thing about it**, and
  module 9 is where that stopped being obvious. "A few residents out on pass" is what this
  line asked for and it cannot be seeded: a pass **outranks a sign-out** in `presenceOf()`
  and pre-accounts its resident on the round, so an active pass on any housed resident
  silently rewrites a fixture another suite depends on — and every housed resident is
  already one (Ocampo and Boone carry the open sign-outs, Ferrer is verify-signouts'
  grace-window case, Castillo is verify-checks' NOT_FOUND). Three attempts each broke a
  different suite. So the seed shows the arc **up to departure** — two awaiting review, one
  approved for next week, one returned, one denied — and `verify-passes.js` creates and owns
  the away and overdue states itself.

---

## Open questions

Resolve these as they come up; update this file when they do.

1. ~~Which state?~~ **Georgia.** Still to confirm from an authoritative source, because
   both affect the schema and the deploy:
   - **Which body applies** — Georgia regulates clinical SUD treatment and recovery
     residences differently, and a non-clinical sober living home may be certified rather
     than licensed. Which one this facility is decides whose rules bind.
   - **The record retention period** — currently the app retains everything and never hard
     deletes, which is safe in the sense that nothing is lost too early. If Georgia sets a
     maximum retention as well as a minimum, that becomes a real requirement rather than a
     default.
   Do not encode any specific Georgia rule from memory. Verify it before it reaches the
   schema or a deploy.
2. How many apartments and beds, at launch and realistically? What's the cohort split?
3. ~~Medication model: observed self-administration only, or does staff store and dispense?~~
   **Staff-stored, resident self-administered** (2026-08-07). The house holds the medications
   and staff hand a dose over and watch it taken; staff never administer, so a clinical MAR is
   out of scope. Each medication carries its own wall-clock times, and a "pass" is derived
   from whose doses fall in a window rather than being an entity. **The house stores no
   controlled substances at all**, which forecloses the count subsystem this file used to
   hedge about rather than deferring it. Late tolerance is **two hours**. See module 6.
   Still open underneath it: whether a dose was *directly observed* or handed over and
   trusted is a separate custody fact nobody has been asked about.
4. Does the facility already have a system (Sober Living App, BestNotes, spreadsheets)
   with data to migrate?
5. Do residents get accounts at intake, or is it staff-entry-only for phase 1?
6. ~~Are drug screens read in-house, sent to a lab, or both?~~ **Both, resident-elected**
   (2026-08-06). A cup is read on site; on a confirmable non-negative the resident decides
   whether it goes to a lab and is charged $50 if they do. See module 5. Still open
   underneath it: whether the collection was *directly observed* is a separate custody
   fact nobody has been asked about, and whether a lab-negative refund has a default
   amount — it is case-by-case today.
7. ~~Billing/rent — in scope?~~ **In scope, and broader than rent:** laundry, trips and
   program fees all land on the same balance, and payment comes through Stripe (built
   2026-08-06). **"Behind" is now answered structurally**: an OPEN invoice, past its due
   date, on a stay that still owes — and the record's red dot is that same moment. The
   **payment term is net 3 days** (2026-08-07), which answers the last part of this that
   was open.
   Still open: **who may waive a fee**, and whether residents see their own balance before
   the resident app exists — though the RLS policies written for invoices already permit
   exactly that read, so it is a UI decision rather than a schema one.
8. Where does this deploy, and does that host offer managed Postgres? Encryption at rest
   and immutable audit logs both depend on the answer.

---

## Working agreement for Claude

- Read this file at the start of every session. Update it when scope, decisions, or the
  stack change — it is the durable record, not the conversation.
- Prefer the vendored shadcn components over custom ones; add new ones with
  `shadcn-vue add` rather than hand-rolling. See UI rules above.
- Ask before inventing domain rules. Curfew times, phase privileges, and service-hour
  targets are facility policy, not defaults to guess at.
- When touching resident data, default to the conservative privacy choice.
- Prefer a working vertical slice over broad scaffolding.
