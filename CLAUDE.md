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
| **Travel pass** | An overnight or multi-day approved absence. Requires approval; bed is held. |
| **Apartment check** | One **hourly round** of an apartment: staff account for every resident who should be on site and note what each present resident is doing. Redefined by the facility 2026-08-06 — not an inspection checklist. Append-only; corrected by amendment. |
| **Maintenance request** | Work needed on an **apartment** — never a bed. Has a reporter, a priority and a lifecycle; closing one requires a note saying what was done. Whether a specific bed is usable is a separate fact on the bed itself. |
| **Stay** | One episode of residency, intake → discharge. A resident who returns gets a new Stay; the Resident record is the person and persists across both. |
| **UA / drug screen** | A urinalysis or other test. Has a result, a collection witness, and chain-of-custody notes. |
| **Med pass** | The scheduled window in which staff observe residents taking their own medication. |
| **Community service** | Hours a resident owes and works off. Tracked against a target. |
| **Intake / Discharge** | Entering and leaving the program. Discharge has a type (successful, AMA, administrative). |
| **Ledger** | A stay's fee history — rent, laundry, trips, program fees, damages, and the payments and credits against them. Append-only. |
| **Balance** | What a resident owes, always `SUM(charges) − SUM(payments + credits)`. **Derived, never stored.** Negative means they are in credit. |

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
  **Balance-overdue joins red with invoicing** (module 11), because a charge has no due
  date and only an invoice does. A section with nothing wrong shows no dot, the same rule
  the census tiles follow: absence of a chip means fine, which keeps a quiet record quiet.
- **Techs see the Clinical group** (decided 2026-08-02). This does not contradict the bell
  rule under module 13 — that one is about *ambient* disclosure, a name against a screen
  result surfacing unbidden on a phone with residents nearby. Opening a named resident's
  record is a deliberate navigation by someone who already knows who they are looking at,
  and the audit log records it. The two are different acts and get different answers.
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
against the page's 30-second tick. Still deferred: **bed holds** arrive with travel
passes (module 9), and the "on pass" chip with them. If the facility outgrows a
screenful of tiles, the fallback is the table variant; the figures row carries over
unchanged.

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

This is the resident record's **Schedule** section (see module 1) and it is read-only there:
the record answers what this person is scheduled for, and the event itself is edited from
the schedule module. That split is what stops twelve rail sections each growing an editor.

**The section is three bands — attendance, the diary, the history** (chosen 2026-08-05 from
three rendered variants; a two-column split and a record-first order were the others).
Schedule-first, because the rail already carries a dot for what needs attention and Overview is
*defined* as the needs-attention surface, so this section does not have to be where a review
starts. What it uniquely answers is "what is this person scheduled for".

- **The diary is FullCalendar's LIST VIEW**, not a hand-rolled day-grouped list — a `list` view
  *is* a day-grouped agenda, and pulse themes it (`listDay*`, `listItemEvent*`, `noEvents*`), so
  the section inherits the board's typography and palette instead of approximating them. The
  plugin is a **subpath of the already-installed package** (`@fullcalendar/vue3/list`), so it
  adds no dependency. It is a **custom 14-day view** (`duration: { days: 14 }`) because the
  shipped ones are 7 days or a calendar month and the endpoint's window is 14.
- **Fed naive wall-clock strings**, never `startsAt` — the same rule as the board, for the same
  reason.
- **`height: 420`, not `'auto'`.** A fortnight of a daily group is eighteen rows over thirteen
  day headers, and at auto height that pushed the attendance history a full screen below the
  fold. Three bands you cannot see together are not three bands.
- **A list day header has TWO cells**, `level` 0 leading and 1 trailing, and a content generator
  replaces the text of BOTH — so overriding it without branching on `level` prints the label
  twice, once at each end of the row. `listDayAltFormat: false` does not help: it suppresses the
  alt *format*, not the alt *cell*. Note it is **not** `listDaySideFormat`, which was v6's name
  and silently does nothing. The trailing cell now carries the day's session count, which is the
  one thing a day header can say that its rows cannot.
- Headers come from **`humanDate`** so today and tomorrow read as "Today" and "Tomorrow" — no
  date format can produce those — and `localDateKeyOf`, not `facilityDateOf`, because
  FullCalendar built that Date from our own naive string.

**Two fields had always been on the wire and dropped.** `hasActiveStay` is why a discharged
resident used to be told "nothing scheduled in the next two weeks" — which reads as a rota gap
and sends somebody hunting for events that ought to be there. There are now **three** empty
states where there was one: no active stay, active but on nothing, and no attendance recorded
yet. And `rescheduled` now shows as the muted word "moved", matching the board.

**`recent` is ordered by the SESSION's date, not `createdAt`.** It was "the ten most recently
*typed* marks", which is a different list the moment anybody back-fills a roll — and the section
presents it as chronological, with a summary and a "since" date reading it as a sequence. There
is an assertion pinning the order.

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
the sign-out is the record), everyone else is marked present-with-note or not found. The
rules at the boundary, each enforced in the service AND asserted in the suite:

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
Randomized and for-cause selection. Records test type, collection time, observing staff,
result, and confirmation status if sent to a lab. Refusals and dilutes are distinct
outcomes, not just "fail." Chain of custody matters — capture it.

### 6. Medication administration
Self-administration observed by staff (typical for sober living; **confirm the facility's
actual model before building** — a clinical MAR is a different and much heavier thing).
Per-resident med list, scheduled pass windows, and a log of given / refused / missed /
held with the observing staff member. Controlled-substance counts if the house stores any.

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
  pattern; module 9's pass expiries will too.
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
Multi-day, approval-gated. Request → review → approve/deny with a reason. Blackout rules
by program phase. Bed is held, and the census reflects "out on pass" rather than empty.

### 10. Maintenance
**Built.** Requests raised against an apartment: title, description, priority, status.
Any staff may file one; admin and house managers close them, and closing requires a
resolution note. Deliberately independent of `Bed.status` — maintenance is a property of
the unit, out-of-service is a property of the bed, and neither drives the other.

### 11. Fee ledger
**Built (partly).** Not a rent ledger — a balance carries rent, laundry, trips, program
fees and damages, categorised so "what did we bill in laundry last quarter" is answerable
without grepping descriptions.

Three properties do the work:

- **The balance is derived on every read**, never stored. A stored total is a second source
  of truth, and the day it disagrees with the lines beneath it there is no way to tell which
  is wrong. `verify-ledger.js` asserts no `balance` column exists anywhere.
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

**Still to build: Stripe.** `LedgerEntry.externalRef` is unique and reserved for the
processor's own id, which is the piece that is painful to retrofit — webhooks are delivered
at-least-once and this table cannot be corrected by deleting a row, so without it one
retried webhook is a permanent duplicate payment. A handler should treat the unique
violation as "already recorded", not as an error. **Before writing that integration, read
the Stripe note under Compliance posture** — what may be sent to Stripe is a 42 CFR Part 2
question, not a technical one.

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

### 14. Dashboard
**Built (2026-08-05).** The landing page at `/`, replacing the census board as home —
a deliberate reversal of the earlier decision, made knowingly: the census keeps its
domain name, its own nav entry and its whole board at `/census`, one tap away, and the
status pill and logo still link to `/` because the pill's figure (overdue / unplaced) is
exactly what the dashboard's panels answer.

The layout is Kasan's own, chosen from a rendered mock: a **greeting header** ("Good
afternoon, Dana" on the **facility clock**, never the browser's) with a **Quick actions**
menu on the right; **three icon status cards** — signed out (with overdue), beds free,
outstanding balances; then two columns, left wider — **Needs attention**, **Signed out**
and **Outstanding balances** panels on the left, **today's schedule** on the right as
FullCalendar's one-day list view (`AppTodaySchedule`; it was a rolling 7-day list first,
narrowed 2026-08-06 by request). The whole day shows, including sessions already over —
the panel answers "what is today's schedule", and un-taken rolls are the queue's
business, not this list's.

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
- **"Outstanding", not "overdue" balances: a positive derived balance on an active
  stay.** A charge has no due date until invoicing (module 11) exists; this card and
  panel are what inherit the true overdue meaning — and the record rail's red dot —
  when it does. The card total is computed as the sum of the rows beneath it, in the
  same read, so the two cannot drift. Largest balance first; `lastPaymentAt` rides
  along because owing $500 having paid last week is a different situation from owing
  $500 in silence.
- **Needs attention is the bell's action items as a panel** — unhoused, rolls due,
  urgent maintenance — in the pill's priority order, each row tagged with its kind.
  **Minus overdue sign-outs** (the Signed out panel is directly beneath; one situation
  should not be two rows) and **minus community service** (left out by request — the
  verification queue stays on `/service` and the rail's amber dot).
- **The beds-free card shows one figure with the cohort split beside it** ("2 · 1 men,
  1 women") — the bare total alone would hide one side full while the other has room,
  which is the exact failure `cohortCapacity()`'s per-cohort shape exists to prevent.
- **`upcoming` crosses the wire in band form**, `{ shared, lanes }` like `GET /schedule`
  and produced by the same merge — there is still no server endpoint returning a flat
  schedule list. `AppTodaySchedule` concatenates the provably-disjoint bands
  client-side (the board's own sanctioned pattern) and renders FullCalendar's shipped
  `listDay` view. Read-only; a row navigates to `/schedule`.
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
now the only inset on the page, which is what gives it meaning. And the three status
cards are LINKS to the page that explains their figure (sign-outs, census, residents) —
a card that names a number should take you where you act on it. One trap hit in
`AppTodaySchedule`: pulse's stylesheets are unlayered and beat Tailwind utilities, so
overriding its nowrap on event titles takes an inline style, not a class.

**Deliberately excluded, so they are not "added later" casually:** an occupancy-over-time
trend (needs replaying `bed_assignments` history per day — a report, not a page read) and
a true attendance rate (whether EXCUSED counts is facility policy nobody has set; the
board's counts stay counts).

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

So, for the Stripe work when it happens:

- **Send no resident name, email, phone or date of birth.** Metadata carries opaque ids
  only, the same rule the audit log already follows.
- Prefer the resident paying through a link they open themselves, so the payment method
  and any identity live with them rather than in our Stripe account.
- The facility's own legal name on the statement descriptor is a disclosure to whoever
  reads the resident's bank statement. Check what the facility wants there.
- Whether any of this is permissible without written consent is a question for whoever
  advises the facility. Do not settle it from this file.

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
- The shell follows shadcn's **sidebar-08** block. Two deliberate deviations: no collapsible
  submenus, because we have no second-level navigation and inventing one to fill the shape
  would be IA written to match a template; and breadcrumb ancestors stay visible below `md`,
  because they replaced a back arrow and a phone is where the way back matters most.

Five things that will trip you up:

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
  cannot enforce, and the remove/restore arc
- `node scripts/verify-residents.js` — 46 assertions on the roster, intake,
  bed moves, discharge, the SSN read restriction, the notification bell, and search.
  Includes the cohort-mismatch 409 and a tech's 403 on bed assignment — the pair the
  census board's free-tile placement rests on
- `node scripts/verify-ledger.js` — 25 assertions on derived balances, the append-only
  guards, dollar-to-cent parsing, and processor-reference idempotency
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
- `node scripts/verify-schedule.js` — 94 assertions on the schedule. On the resident record:
  `recent` coming back **newest-session-first** (nothing pinned that before, and the section now
  reads it as a sequence), and `hasActiveStay` being **true for an active resident and false for
  a discharged one** — the pair the section's three empty states rest on. **Thirty on editing,
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
- `node scripts/verify-dashboard.js` — 22 assertions on the landing page's one read:
  staff-gated, capacity per cohort with no combined total, `upcoming` in band form over
  a one-day window with nothing shared also in a lane, every queue equal to its source
  endpoint (sign-outs
  with matching overdue flags and destinations, the census's unhoused, the board's roll
  queue, open URGENT maintenance), balances summing to their own card and agreeing with
  the roster, a probe payment moving the total on the next read, and a probe sign-out
  surfacing and being cleaned up again. Posts a $1 payment — reseed after.
- `node scripts/verify-checks.js` — 65 assertions on the hourly round: the staff gate, the
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
  Posts checks — reseed after.
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
  && node scripts/verify-dashboard.js && node scripts/seed.js \
  && node scripts/verify-checks.js && node scripts/seed.js \
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
  time-critical and cross midnight, so every scheduled local time is read against the
  facility timezone — a **single value in `FACILITY_TIMEZONE`**, not a column. The
  facility is one site; if a second site in another zone ever opens, that is the
  assumption to revisit. `server/src/lib/facilityTime.js` (wall-clock → UTC and back,
  no timezone library) is the one place that interprets it; the admin app mirrors the
  display half in `utils/facilityTime.js` as a copied constant. The older `isoDate()`
  UTC-slice helper is fine for dates, wrong for times — do not reuse it for anything
  with a clock.

  **The value is `America/New_York`** — the facility is in Georgia. It was
  `America/Chicago` first and every time in the app read an hour early. Note the zone
  lives in **five** places, only three of them env-driven: `server/.env`,
  `server/.env.example`, the `?? ` fallbacks in `lib/facilityTime.js` and
  `scripts/verify-signouts.js`, and the **hardcoded copy** in the admin app's
  `utils/facilityTime.js`. Changing the environment alone leaves the client an hour
  off, which is what makes this worth stating rather than deriving.
- Mobile-first CSS for anything a tech touches in the hallway.
- Seed data should look like a real facility: several apartments across both cohorts, a
  full census, a few residents out on pass, one overdue sign-out.

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
3. Medication model: observed self-administration only, or does staff store and dispense?
4. Does the facility already have a system (Sober Living App, BestNotes, spreadsheets)
   with data to migrate?
5. Do residents get accounts at intake, or is it staff-entry-only for phase 1?
6. Are drug screens read in-house, sent to a lab, or both?
7. ~~Billing/rent — in scope?~~ **In scope, and broader than rent:** laundry, trips and
   program fees all land on the same balance, and payment will come through Stripe. Still
   open: what counts as "behind" (the roster deliberately does not colour a balance,
   because that threshold is facility policy), whether residents see their own balance
   before the resident app exists, and who may waive a fee.
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
