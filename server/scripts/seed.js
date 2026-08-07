/**
 * Development seed. Looks like a real facility, per CLAUDE.md: apartments in
 * both cohorts, a full-ish census, someone out on pass, one overdue sign-out
 * (once those tables exist).
 *
 * Passwords here are development-only and printed to the console on purpose.
 * Never run this against production.
 */
import './lib/as-owner.js'
import { resetFacilityData } from './lib/reset.js'
import { prisma } from '../src/db/client.js'
import { runAsSystem } from '../src/lib/dbContext.js'
import { hashPassword } from '../src/auth/passwords.js'
import { facilityToday } from '../src/lib/facilityTime.js'
import { addDays, dateKeyToUtc } from '../src/services/schedule/expand.js'

const DEV_PASSWORD = 'soberlife-dev-1234'

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.')
  }

  console.log('Seeding…')
  await resetFacilityData(prisma)

  const passwordHash = await hashPassword(DEV_PASSWORD)

  const [admin, manager, tech] = await Promise.all([
    prisma.user.create({
      data: { email: 'admin@facility.test', passwordHash, fullName: 'Dana Reyes', role: 'ADMIN' },
    }),
    prisma.user.create({
      data: {
        email: 'manager@facility.test',
        passwordHash,
        fullName: 'Marcus Hale',
        role: 'HOUSE_MANAGER',
      },
    }),
    prisma.user.create({
      data: { email: 'tech@facility.test', passwordHash, fullName: 'Priya Nair', role: 'STAFF' },
    }),
  ])

  // The dormant account that owns machine-written ledger rows — a Stripe
  // webhook has no human behind it, and `recordedById` is NOT NULL. isActive
  // false, so login refuses it before a password is ever compared. Upserted
  // rather than created because reset.js keeps non-.test accounts and this one
  // must survive a reseed.
  const stripeUser = await prisma.user.upsert({
    where: { email: 'stripe@system.soberlife' },
    update: {},
    create: {
      email: 'stripe@system.soberlife',
      passwordHash: 'x',
      fullName: 'Stripe (automated)',
      role: 'STAFF',
      isActive: false,
    },
  })

  // Phase privileges are deliberately left null — facility policy, not ours to
  // invent. See CLAUDE.md.
  // Orientation is level 0: the restricted first stretch before Phase 1. It is a
  // Program row rather than a separate status field, so intake picks a standing
  // and a phase from one list instead of two concepts meaning nearly the same.
  //
  // serviceHoursRequired is the PHASE DEFAULT target, overridable per stay. It
  // is the first of Program's four policy columns to be filled in; the other
  // three still ship empty, per the model's own comment. Orientation stays null
  // on purpose — nothing is owed in the restricted first stretch — though no
  // seeded resident is on it, so the no-target rendering is exercised by
  // verify-service.js rather than by the seed.
  const [orientation, phase1, phase2] = await Promise.all([
    prisma.program.create({ data: { name: 'Orientation', level: 0 } }),
    prisma.program.create({ data: { name: 'Phase 1', level: 1, serviceHoursRequired: 20 } }),
    prisma.program.create({ data: { name: 'Phase 2', level: 2, serviceHoursRequired: 40 } }),
  ])
  const apt12 = await prisma.apartment.create({
    data: { name: 'Apt 12', cohort: 'MEN' },
  })
  const apt14 = await prisma.apartment.create({
    data: { name: 'Apt 14', cohort: 'WOMEN' },
  })

  const mensBeds = await Promise.all(
    ['A', 'B', 'C', 'D'].map((label) =>
      prisma.bed.create({ data: { apartmentId: apt12.id, cohort: 'MEN', label } }),
    ),
  )
  const womensBeds = await Promise.all(
    ['A', 'B', 'C'].map((label) =>
      prisma.bed.create({ data: { apartmentId: apt14.id, cohort: 'WOMEN', label } }),
    ),
  )

  // One bed out of service, so the census has a realistic hole in it.
  await prisma.bed.update({
    where: { id: mensBeds[3].id },
    data: { status: 'OUT_OF_SERVICE', outOfServiceNote: 'Window latch broken — work order 118' },
  })

  const people = [
    {
      first: 'Andre', last: 'Whitfield', cohort: 'MEN', bed: mensBeds[0], program: phase2,
      ssn: '4471', email: 'a.whitfield@example.com', sober: '2025-11-30',
      notes: 'Self-referred after completing detox. Has transport to work.',
    },
    { first: 'Danny', last: 'Ocampo', cohort: 'MEN', bed: mensBeds[1], program: phase1 },
    { first: 'Ruben', last: 'Castillo', cohort: 'MEN', bed: mensBeds[2], program: phase1 },
    {
      first: 'Tasha', last: 'Boone', cohort: 'WOMEN', bed: womensBeds[0], program: phase2,
      ssn: '9012', email: 't.boone@example.com', sober: '2026-04-18',
    },
    { first: 'Marisol', last: 'Ferrer', cohort: 'WOMEN', bed: womensBeds[1], program: phase1 },
  ]

  const seededStays = []

  for (const p of people) {
    const resident = await prisma.resident.create({
      data: {
        firstName: p.first,
        lastName: p.last,
        cohort: p.cohort,
        // Fabricated, and only ever the last four — see the CHECK constraint.
        ssnLast4: p.ssn ?? null,
        email: p.email ?? null,
        phone: '512-555-0'.concat(String(100 + seededStays.length + 1)),
      },
    })
    const stay = await prisma.stay.create({
      data: {
        residentId: resident.id,
        cohort: p.cohort,
        programId: p.program.id,
        intakeAt: new Date('2026-05-01T15:00:00Z'),
        expectedDischargeAt: new Date('2026-11-01T15:00:00Z'),
        referralSource: 'Travis County drug court',
        sobrietyDate: p.sober ? new Date(p.sober) : null,
        intakeNotes: p.notes ?? null,
      },
    })
    await prisma.bedAssignment.create({
      data: {
        bedId: p.bed.id,
        stayId: stay.id,
        cohort: p.cohort,
        startedAt: new Date('2026-05-01T15:00:00Z'),
        assignedById: manager.id,
      },
    })
    await prisma.emergencyContact.create({
      data: {
        residentId: resident.id,
        name: `${p.first}'s emergency contact`,
        relationship: 'Parent',
        phone: '512-555-0100',
        isPrimary: true,
      },
    })
    seededStays.push({ person: p, stayId: stay.id })
  }

  // Two states the roster has to handle, seeded so they are always visible:
  // someone intaked but not yet in a bed, and someone already discharged.
  const unhoused = await prisma.resident.create({
    data: { firstName: 'Joy', lastName: 'Nakamura', cohort: 'WOMEN' },
  })
  await prisma.stay.create({
    data: {
      residentId: unhoused.id,
      cohort: 'WOMEN',
      programId: phase1.id,
      intakeAt: new Date(),
      referralSource: 'Self-referral',
    },
  })

  const alum = await prisma.resident.create({
    data: { firstName: 'Curtis', lastName: 'Ramsey', cohort: 'MEN' },
  })
  const alumStay = await prisma.stay.create({
    data: {
      residentId: alum.id,
      cohort: 'MEN',
      programId: phase2.id,
      intakeAt: new Date('2025-11-03T15:00:00Z'),
      status: 'DISCHARGED',
      dischargedAt: new Date('2026-04-15T16:00:00Z'),
      dischargeType: 'SUCCESSFUL',
      dischargeReason: 'Completed the program and moved to independent housing.',
    },
  })
  // Created already closed. A live assignment here would collide with Ruben's
  // on the same bed — the partial unique index allows only one at a time — and
  // the history has to read correctly anyway: this resident vacated 12C in
  // April, and Ruben moved in on 1 May.
  await prisma.bedAssignment.create({
    data: {
      bedId: mensBeds[2].id,
      stayId: alumStay.id,
      cohort: 'MEN',
      startedAt: new Date('2025-11-03T15:00:00Z'),
      endedAt: new Date('2026-04-15T16:00:00Z'),
      endedReason: 'discharge',
      assignedById: manager.id,
    },
  })

  // ── Fee ledger ────────────────────────────────────────────────────────────
  // Not only rent: laundry, trips and damages land on the same balance. Seeded
  // so the roster shows the four states that actually occur — square, part-paid,
  // badly behind, and in credit — because a column where every row reads $0.00
  // tells you nothing about whether the column works.
  const CENTS = (dollars) => Math.round(dollars * 100)
  const MONTHS = ['2026-05', '2026-06', '2026-07']

  /** How much of the rent each person has actually paid, by month. */
  const paymentProfile = {
    Whitfield: [1, 1, 1], // square
    Ocampo: [1, 1, 0], // a month behind
    Castillo: [1, 0.5, 0], // badly behind — the one a manager needs to see
    Boone: [1, 1, 1],
    Ferrer: [1, 1, 1], // plus a credit below, so one row shows a negative
  }

  // Insurance and the new intake fields, on a couple of people rather than all
  // of them: a seed where every record is complete hides the empty states.
  await prisma.insurancePolicy.create({
    data: {
      residentId: (await prisma.resident.findFirst({ where: { lastName: 'Whitfield' } })).id,
      provider: 'Blue Cross Blue Shield of Georgia',
      policyNumber: 'BCBSGA88401277',
      groupNumber: 'GRP20461',
    },
  })
  await prisma.insurancePolicy.create({
    data: {
      residentId: (await prisma.resident.findFirst({ where: { lastName: 'Boone' } })).id,
      provider: 'Ambetter',
      policyNumber: 'AMB5520914',
      policyHolder: 'Denise Boone',
    },
  })

  for (const { person, stayId } of seededStays) {
    const paid = paymentProfile[person.last] ?? [1, 1, 1]

    for (const [i, month] of MONTHS.entries()) {
      await prisma.ledgerEntry.create({
        data: {
          stayId,
          type: 'CHARGE',
          category: 'RENT',
          amountCents: CENTS(650),
          description: `Rent ${month}`,
          occurredAt: new Date(`${month}-01T12:00:00Z`),
          recordedById: manager.id,
        },
      })

      const share = paid[i] ?? 0
      if (share > 0) {
        await prisma.ledgerEntry.create({
          data: {
            stayId,
            type: 'PAYMENT',
            amountCents: CENTS(650 * share),
            description: share === 1 ? `Rent ${month} paid` : `Rent ${month} part payment`,
            occurredAt: new Date(`${month}-03T12:00:00Z`),
            recordedById: manager.id,
            // Stripe-shaped, and unique: a webhook delivered twice must not be
            // able to post this payment a second time.
            externalRef: `pi_seed_${stayId.slice(-8)}_${month}`,
          },
        })
      }
    }

    // The fees that make this a fee ledger rather than a rent ledger.
    await prisma.ledgerEntry.create({
      data: {
        stayId,
        type: 'CHARGE',
        category: 'LAUNDRY',
        amountCents: CENTS(20),
        description: 'Laundry — July',
        occurredAt: new Date('2026-07-05T12:00:00Z'),
        recordedById: tech.id,
      },
    })
  }

  const byLast = (last) => seededStays.find((x) => x.person.last === last)?.stayId

  await prisma.ledgerEntry.create({
    data: {
      stayId: byLast('Boone'),
      type: 'CHARGE',
      category: 'TRIP',
      amountCents: CENTS(35),
      description: 'Group outing — transport share',
      occurredAt: new Date('2026-07-19T12:00:00Z'),
      recordedById: tech.id,
    },
  })

  await prisma.ledgerEntry.create({
    data: {
      stayId: byLast('Castillo'),
      type: 'CHARGE',
      category: 'DAMAGE',
      amountCents: CENTS(85),
      description: 'Replaced bedroom door handle',
      occurredAt: new Date('2026-06-22T12:00:00Z'),
      recordedById: manager.id,
    },
  })

  // A credit, so one resident sits in credit and the roster has to render a
  // negative balance rather than assuming money only ever flows one way.
  await prisma.ledgerEntry.create({
    data: {
      stayId: byLast('Ferrer'),
      type: 'CREDIT',
      amountCents: CENTS(120),
      description: 'Program fee waived — hardship, approved by director',
      occurredAt: new Date('2026-07-11T12:00:00Z'),
      recordedById: manager.id,
    },
  })

  // ── Invoices ──────────────────────────────────────────────────────────────
  // Two invoices with different fates, so a fresh seed shows both halves of
  // module 11: one PAID (with the payment that settled it), and one long past
  // due — old enough to be past the 7-day dot grace, so the resident record's
  // red dot and the dashboard's overdue badge have something real to render.
  // Everyone else's charges stay unbilled, which is what the Send invoice and
  // the Friday weekly-run buttons act on.
  const invoiceFor = async (stayId, { daysAgo, paid }) => {
    const issued = new Date(Date.now() - daysAgo * 24 * 3_600_000)
    const billable = await prisma.ledgerEntry.findMany({
      where: { stayId, type: { in: ['CHARGE', 'CREDIT'] }, invoiceLine: { is: null } },
      orderBy: { occurredAt: 'asc' },
      take: 2,
    })
    if (!billable.length) return null
    const total = billable.reduce(
      (t, e) => t + (e.type === 'CHARGE' ? e.amountCents : -e.amountCents),
      0,
    )
    if (total <= 0) return null
    // Follows the REAL arc rather than short-cutting it: lines may only be
    // added while an invoice is DRAFT (a line appended after finalization
    // would make totalCents stop matching what is beneath it), and the status
    // only ever moves forwards. The seed going through the same doors as the
    // app is what makes it a trustworthy fixture.
    const draft = await prisma.invoice.create({
      data: {
        stayId,
        totalCents: total,
        // Due on receipt, so the issue date is the due date.
        dueAt: issued,
        createdAt: issued,
        sentById: manager.id,
        lines: { create: billable.map((e) => ({ ledgerEntryId: e.id })) },
      },
    })

    const open = await prisma.invoice.update({
      where: { id: draft.id },
      data: {
        status: 'OPEN',
        // Seed-shaped and unique: obviously not a real Stripe id.
        stripeInvoiceId: `in_seed_${stayId.slice(-8)}_${daysAgo}`,
        number: `SL-${1000 + daysAgo}`,
        hostedUrl: `https://invoice.stripe.com/i/seed_${stayId.slice(-8)}`,
        issuedAt: issued,
        finalizedAt: issued,
      },
    })
    if (!paid) return open

    return prisma.invoice.update({
      where: { id: draft.id },
      data: { status: 'PAID', paidAt: new Date(issued.getTime() + 2 * 24 * 3_600_000) },
    })
  }

  // Paid: Whitfield's, settled two days after it was sent.
  const paidInvoice = await invoiceFor(byLast('Whitfield'), { daysAgo: 30, paid: true })
  if (paidInvoice) {
    await prisma.ledgerEntry.create({
      data: {
        stayId: byLast('Whitfield'),
        type: 'PAYMENT',
        amountCents: paidInvoice.totalCents,
        description: 'Card payment',
        occurredAt: paidInvoice.paidAt,
        // What a real webhook would have written, recorded by the machine
        // account rather than by a person who never touched the money.
        externalRef: `stripe_pi_seed_${byLast('Whitfield').slice(-8)}`,
        recordedById: stripeUser.id,
      },
    })
  }

  // Overdue by three weeks, so it is well past the dot's 7-day grace.
  await invoiceFor(byLast('Castillo'), { daysAgo: 21, paid: false })

  // ── Sign-outs ─────────────────────────────────────────────────────────────
  // Relative times, because seed runs at arbitrary wall-clock moments: one
  // resident out and expected back later, one OVERDUE (past expected return
  // and the 15-minute grace), and one completed round trip so the returned
  // list has data. The overdue one makes the census stripe, the red pill and
  // the bell all light on first login.
  const HOUR = 3_600_000
  const nowMs = Date.now()

  await prisma.signOut.create({
    data: {
      stayId: byLast('Ocampo'),
      destination: "NA meeting — St. Mark's",
      purpose: 'Evening meeting, sponsor driving',
      outAt: new Date(nowMs - 1 * HOUR),
      expectedReturnAt: new Date(nowMs + 3 * HOUR),
      recordedById: tech.id,
    },
  })

  await prisma.signOut.create({
    data: {
      stayId: byLast('Boone'),
      destination: 'Work shift — Kroger',
      outAt: new Date(nowMs - 5 * HOUR),
      // 2h41m late: well past the grace window, so "Overdue 2h 41m" renders.
      expectedReturnAt: new Date(nowMs - (2 * HOUR + 41 * 60_000)),
      recordedById: manager.id,
    },
  })

  await prisma.signOut.create({
    data: {
      stayId: byLast('Whitfield'),
      destination: 'Probation check-in',
      outAt: new Date(nowMs - 26 * HOUR),
      expectedReturnAt: new Date(nowMs - 24 * HOUR),
      returnedAt: new Date(nowMs - 24 * HOUR - 20 * 60_000),
      returnAcknowledgedById: tech.id,
      recordedById: tech.id,
    },
  })

  // ── Apartment checks ──────────────────────────────────────────────────────
  // The hourly round, backfilled over the last six hours with relative times
  // (same reasoning as the sign-outs above). What a fresh seed shows: the
  // men's apartment CHECKED minutes ago with one resident NOT FOUND (the bell
  // and Needs attention light), the women's apartment OVERDUE (~95 minutes
  // since its last check, past the hour plus the 15-minute grace), one
  // mid-morning hour skipped on the women's side (the log shows a missed
  // bucket — an absence, nothing written), and one earlier check amended with
  // a reason. Lines agree with the sign-outs: Ocampo left an hour ago, so
  // older checks mark him PRESENT and the latest marks him SIGNED_OUT; Boone
  // has been out five hours, so every seeded women's check marks her out.
  const MIN = 60_000
  const createCheck = (apartmentId, at, byId, lines, extra = {}) =>
    prisma.apartmentCheck.create({
      data: {
        apartmentId,
        checkedAt: at,
        recordedById: byId,
        residents: { create: lines },
        ...extra,
      },
    })

  const mensNotes = [
    'Sleeping',
    'In room, reading',
    'Common area, watching TV',
    'Cooking dinner',
    'On the porch with his sponsor book',
    'Doing chores',
  ]
  for (let k = 6; k >= 1; k--) {
    const at = new Date(nowMs - k * HOUR - 7 * MIN)
    await createCheck(apt12.id, at, tech.id, [
      { stayId: byLast('Whitfield'), status: 'PRESENT', note: mensNotes[k % mensNotes.length] },
      // Ocampo signed out one hour ago; before that he was home.
      k >= 2
        ? { stayId: byLast('Ocampo'), status: 'PRESENT', note: mensNotes[(k + 2) % mensNotes.length] }
        : { stayId: byLast('Ocampo'), status: 'SIGNED_OUT' },
      { stayId: byLast('Castillo'), status: 'PRESENT', note: mensNotes[(k + 4) % mensNotes.length] },
    ])
  }
  // The latest men's check, twenty minutes ago: CHECKED this hour, and
  // Castillo could not be found — no open sign-out, so the bell carries him
  // until the next check or a sign-out accounts for him.
  await createCheck(apt12.id, new Date(nowMs - 20 * MIN), tech.id, [
    { stayId: byLast('Whitfield'), status: 'PRESENT', note: 'Common area, watching TV' },
    { stayId: byLast('Ocampo'), status: 'SIGNED_OUT' },
    { stayId: byLast('Castillo'), status: 'NOT_FOUND', note: 'Not in his room or the common areas' },
  ])

  // The women's side: hourly until 95 minutes ago, then nothing — so the
  // apartment sits OVERDUE on first login. Hour k=4 is skipped on purpose:
  // that is what a missed bucket looks like in the log.
  for (let k = 6; k >= 2; k--) {
    if (k === 4) continue
    const at = new Date(nowMs - k * HOUR - 12 * MIN)
    await createCheck(apt14.id, at, k % 2 === 0 ? manager.id : tech.id, [
      k >= 5
        ? { stayId: byLast('Boone'), status: 'PRESENT', note: 'Getting ready for her shift' }
        : { stayId: byLast('Boone'), status: 'SIGNED_OUT' },
      { stayId: byLast('Ferrer'), status: 'PRESENT', note: 'In room, on the phone with family' },
    ])
  }
  const womensLast = await createCheck(apt14.id, new Date(nowMs - 95 * MIN), tech.id, [
    { stayId: byLast('Boone'), status: 'SIGNED_OUT' },
    { stayId: byLast('Ferrer'), status: 'PRESENT', note: 'Doing laundry' },
  ])

  // One amendment, so the log renders the marker: same visit, same instant,
  // corrected note, reason attached. The original stays.
  await createCheck(
    apt14.id,
    womensLast.checkedAt,
    manager.id,
    [
      { stayId: byLast('Boone'), status: 'SIGNED_OUT' },
      { stayId: byLast('Ferrer'), status: 'PRESENT', note: 'Doing laundry in the downstairs room' },
    ],
    {
      supersedesId: womensLast.id,
      amendmentReason: 'Wrong room noted — corrected after the walk.',
    },
  )

  // ── Drug screens ──────────────────────────────────────────────────────────
  // One row for every band of /screens, so the page has something to show on
  // first login: a plain negative, a positive awaiting the resident's answer,
  // a positive they declined to confirm, one at the lab, and one where the lab
  // CLEARED a resident who paid — the case-by-case refund surface, with no
  // credit posted, because the app never moves that money by itself.
  const DAY = 24 * HOUR
  // createdAt is set explicitly to just after the collection, because
  // screen_collected_at_sane bounds back-fill to a shift — and a historical
  // row whose createdAt is "now" is a row claiming it was typed today, which
  // is exactly the dishonesty that constraint exists to catch. A real database
  // has these rows created when they happened.
  const screen = (data) =>
    prisma.drugScreen.create({
      data: { createdAt: new Date(data.collectedAt.getTime() + 4 * 60_000), ...data },
    })

  await screen({
    stayId: byLast('Whitfield'),
    reason: 'RANDOM',
    method: 'URINE',
    collectedAt: new Date(nowMs - 3 * HOUR),
    witnessedById: tech.id,
    result: 'NEGATIVE',
    substances: [],
    recordedById: tech.id,
    confirmation: 'NOT_OFFERED',
  })

  // Awaiting the resident's decision — the loudest band, because an offer with
  // no recorded answer is the evidence gap this module exists to close.
  await screen({
    stayId: byLast('Ocampo'),
    reason: 'FOR_CAUSE',
    method: 'URINE',
    collectedAt: new Date(nowMs - 5 * HOUR),
    witnessedById: manager.id,
    result: 'POSITIVE',
    substances: ['THC'],
    specimenId: 'SL-40881',
    note: 'Returned from a pass looking unsteady.',
    recordedById: manager.id,
    confirmation: 'PENDING_DECISION',
  })

  // Offered and declined — a record, never an absence.
  await screen({
    stayId: byLast('Ferrer'),
    reason: 'RANDOM',
    method: 'URINE',
    collectedAt: new Date(nowMs - 20 * HOUR),
    witnessedById: tech.id,
    result: 'DILUTE',
    substances: [],
    specimenId: 'SL-40877',
    recordedById: tech.id,
    confirmation: 'DECLINED',
    residentDecisionAt: new Date(nowMs - 19 * HOUR),
    decisionRecordedById: tech.id,
  })

  // At the lab.
  await screen({
    stayId: byLast('Castillo'),
    reason: 'RANDOM',
    method: 'URINE',
    collectedAt: new Date(nowMs - 22 * HOUR),
    witnessedById: tech.id,
    result: 'POSITIVE',
    substances: ['BENZODIAZEPINES'],
    specimenId: 'SL-40874',
    recordedById: tech.id,
    confirmation: 'REQUESTED',
    residentDecisionAt: new Date(nowMs - 21 * HOUR),
    decisionRecordedById: tech.id,
    labName: 'Quest Diagnostics',
    labReference: 'Q-55120',
    labSentAt: new Date(nowMs - 21 * HOUR),
  })

  // The contradiction: a positive cup, a negative lab, and a resident who paid
  // $50. The charge is real; the credit deliberately is not — a manager
  // decides case by case, and this is what they review.
  const labFee = await prisma.ledgerEntry.create({
    data: {
      stayId: byLast('Boone'),
      type: 'CHARGE',
      category: 'LAB_FEE',
      amountCents: 5000,
      description: 'Lab confirmation fee',
      occurredAt: new Date(nowMs - 4 * DAY),
      recordedById: manager.id,
    },
  })
  await screen({
    stayId: byLast('Boone'),
    reason: 'FOR_CAUSE',
    method: 'URINE',
    collectedAt: new Date(nowMs - 4 * DAY),
    witnessedById: manager.id,
    result: 'POSITIVE',
    substances: ['OPIATES'],
    specimenId: 'SL-40790',
    recordedById: manager.id,
    confirmation: 'RETURNED',
    residentDecisionAt: new Date(nowMs - 4 * DAY),
    decisionRecordedById: manager.id,
    feeLedgerEntryId: labFee.id,
    labName: 'Quest Diagnostics',
    labReference: 'Q-54980',
    labSentAt: new Date(nowMs - 4 * DAY),
    labResult: 'NEGATIVE',
    labSubstances: [],
    labReturnedAt: new Date(nowMs - 1 * DAY),
    labRecordedById: manager.id,
  })

  // ── Community service ───────────────────────────────────────────────────
  // Intake is 2026-05-01, so every seeded resident is months into a stay and
  // the quota has bitten several times over. The point of this block is that a
  // fresh seed shows the amber dot on somebody, a clean bar on somebody else,
  // an entry awaiting a signature, and one amended entry — the four states the
  // section has to render.
  // Not HOUR — that is already milliseconds above, for the sign-out fixtures.
  const MINUTES_PER_HOUR = 60

  async function logHours(stayId, { hours, daysAgo, location, supervisor, phone, verified, note }) {
    return prisma.serviceEntry.create({
      data: {
        stayId,
        minutes: hours * MINUTES_PER_HOUR,
        workedOn: new Date(new Date(nowMs - daysAgo * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z'),
        location,
        supervisorName: supervisor,
        supervisorPhone: phone ?? null,
        note: note ?? null,
        recordedById: tech.id,
        ...(verified ? { verifiedAt: new Date(nowMs - (daysAgo - 1) * 86_400_000), verifiedById: manager.id } : {}),
      },
    })
  }

  // Ruben carries a COURT-ORDERED override: 120 hours, not Phase 1's 20. On the
  // stay rather than the program, so moving him to Phase 2 will not quietly
  // reduce what a judge ordered.
  await prisma.stay.update({
    where: { id: byLast('Castillo') },
    data: { serviceHoursRequired: 120 },
  })

  // The seeded intake is 2026-05-01, so everyone housed is three whole months
  // in and owes their full target under the 20 h/month pace. The hours below
  // are sized so MOST residents are clear and only two carry a dot — a board
  // where everybody is amber teaches people to ignore amber, which is the
  // failure CLAUDE.md names about noisy indicators.
  const HABITAT = { location: 'Habitat ReStore', supervisor: 'Dana Cole', phone: '404-555-0143' }
  const FOODBANK = { location: 'Food bank', supervisor: 'Rita Mbeki' }
  const CHURCH = { location: 'Church grounds', supervisor: 'Paul Nwosu' }

  // Andre (Phase 2, target 40): 42 verified — done, and one slip still pending.
  for (const [hours, daysAgo, place] of [
    [8, 74, HABITAT], [8, 60, HABITAT], [8, 46, FOODBANK], [6, 32, CHURCH], [6, 18, HABITAT], [6, 11, FOODBANK],
  ]) await logHours(byLast('Whitfield'), { hours, daysAgo, ...place, verified: true })
  await logHours(byLast('Whitfield'), { hours: 4, daysAgo: 3, ...CHURCH, verified: false })

  // Marisol (Phase 1, target 20): exactly met. No dot, no fuss.
  for (const [hours, daysAgo, place] of [[6, 68, FOODBANK], [8, 40, HABITAT], [6, 15, CHURCH]])
    await logHours(byLast('Ferrer'), { hours, daysAgo, ...place, verified: true })

  // Ruben carries the 120-hour court order, so 60 is due by now and he has 45.
  // BEHIND BY 15 — somebody slipping, not somebody who never started.
  for (const [hours, daysAgo, place] of [
    [8, 78, HABITAT], [8, 64, HABITAT], [7, 50, FOODBANK], [8, 36, HABITAT], [6, 22, CHURCH], [8, 12, HABITAT],
  ]) await logHours(byLast('Castillo'), { hours, daysAgo, ...place, verified: true })
  await logHours(byLast('Castillo'), { hours: 3.5, daysAgo: 2, ...HABITAT, verified: false, note: 'Slip handed in at the office.' })

  // Tasha's entry was AMENDED: eight hours logged, the supervisor's sheet said
  // five. The original stays, the amendment supersedes it, and only the
  // amendment counts. Note the amendment starts unverified — the original's
  // sign-off was about a number that has just changed.
  for (const [hours, daysAgo, place] of [[8, 70, HABITAT], [8, 55, FOODBANK], [8, 44, HABITAT], [6, 20, CHURCH], [5, 8, FOODBANK]])
    await logHours(byLast('Boone'), { hours, daysAgo, ...place, verified: true })
  const overstated = await logHours(byLast('Boone'), { hours: 8, daysAgo: 31, ...CHURCH, verified: true })
  await prisma.serviceEntry.create({
    data: {
      stayId: byLast('Boone'),
      minutes: 5 * MINUTES_PER_HOUR,
      workedOn: overstated.workedOn,
      location: overstated.location,
      supervisorName: overstated.supervisorName,
      recordedById: manager.id,
      supersedesId: overstated.id,
      amendmentReason: "Supervisor's sheet says 5 hours, not 8.",
    },
  })

  // Danny is Phase 1 with nothing logged at all, so he is behind on the phase
  // default rather than on a court order — two residents amber for two
  // different reasons, which is what a real house looks like.
  //
  // Joy intakes TODAY on Phase 1, so she has a 20-hour target and owes none of
  // it yet: zero whole months elapsed, no dot. That is the first-month grace
  // the whole-month step exists to give, visible on a fresh seed.

  // Maintenance is raised against the APARTMENT. Bed 12D carries its own
  // out-of-service note; the two read as related without being linked.
  await prisma.maintenanceRequest.create({
    data: {
      apartmentId: apt12.id,
      title: 'Window latch broken — work order 118',
      description: 'Bedroom window will not latch shut. Vendor scheduled.',
      priority: 'URGENT',
      status: 'OPEN',
      reportedById: manager.id,
      reportedAt: new Date('2026-07-28T14:10:00Z'),
    },
  })
  await prisma.maintenanceRequest.create({
    data: {
      apartmentId: apt12.id,
      title: 'Kitchen faucet dripping',
      priority: 'LOW',
      status: 'RESOLVED',
      reportedById: tech.id,
      reportedAt: new Date('2026-06-02T09:00:00Z'),
      resolvedById: manager.id,
      resolvedAt: new Date('2026-06-04T16:30:00Z'),
      resolutionNote: 'Replaced washer and seated the cartridge. No leak after 24h.',
    },
  })

  // ── The schedule ────────────────────────────────────────────────────────
  // A week that looks like a real house: a daily reflection both cohorts
  // attend at different times, a Monday house meeting likewise, one process
  // group per cohort on its own night, and a one-off outing. Plus one roll
  // already taken and one deliberately missed, so the board has something in
  // both states the moment you open it.
  const stayIdsFor = (cohort) =>
    seededStays.filter((s) => s.person.cohort === cohort).map((s) => s.stayId)
  const menStays = stayIdsFor('MEN')
  const womenStays = stayIdsFor('WOMEN')

  const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
  const SCHEDULE_FROM = '2026-05-01'

  const cohortOfStay = new Map([
    ...menStays.map((id) => [id, 'MEN']),
    ...womenStays.map((id) => [id, 'WOMEN']),
  ])

  /**
   * One event with ONE time, fanned out to one occurrence per attending cohort
   * and one combined roster split by each stay's own cohort — mirroring
   * services/schedule/write.js exactly, so the seed teaches the real shape.
   */
  async function seedEvent({ title, description, location, cohorts, at, minutes, weekdays, startsOn, stayIds }) {
    const event = await prisma.scheduleEvent.create({
      data: { title, description: description ?? null, location: location ?? null, createdById: manager.id },
    })
    const made = {}
    for (const cohort of cohorts) {
      const occurrence = await prisma.scheduleOccurrence.create({
        data: {
          eventId: event.id,
          cohort,
          startsAtLocal: at,
          durationMinutes: minutes,
          recurrence: weekdays ? 'WEEKLY' : 'ONCE',
          weekdays: weekdays ?? [],
          startsOn: dateKeyToUtc(startsOn ?? SCHEDULE_FROM),
          endsOn: weekdays ? null : dateKeyToUtc(startsOn),
        },
      })
      const mine = stayIds.filter((id) => cohortOfStay.get(id) === cohort)
      if (mine.length) {
        await prisma.scheduleAttendee.createMany({
          data: mine.map((stayId) => ({
            occurrenceId: occurrence.id,
            cohort,
            stayId,
            addedById: manager.id,
          })),
        })
      }
      made[cohort] = occurrence
    }
    return made
  }

  // Morning Reflection runs at 7:00 for the men and 7:30 for the women. Under
  // one-time-per-event that is TWO EVENTS, not one with a staggered pair — and
  // that is the honest reading: they are two meetings in the same room half an
  // hour apart. The seed is where anyone looks to learn how the model wants to
  // be used, so it says so rather than collapsing them to a single time.
  const { MEN: morningMen } = await seedEvent({
    title: 'Morning Reflection — Men',
    description: 'Ten minutes of reading, then the day ahead.',
    location: 'Common room',
    cohorts: ['MEN'],
    at: '07:00',
    minutes: 30,
    weekdays: EVERY_DAY,
    stayIds: menStays,
  })

  await seedEvent({
    title: 'Morning Reflection — Women',
    description: 'Ten minutes of reading, then the day ahead.',
    location: 'Common room',
    cohorts: ['WOMEN'],
    at: '07:30',
    minutes: 30,
    weekdays: EVERY_DAY,
    stayIds: womenStays,
  })

  // The flagship both-cohorts event: one card on the board, one roll, one queue
  // entry. Everyone in the house, in one room, at one time.
  const houseMeeting = await seedEvent({
    title: 'House Meeting',
    description: 'Chores, conflicts, and anything the house needs to hear.',
    location: 'Common room',
    cohorts: ['MEN', 'WOMEN'],
    at: '18:00',
    minutes: 60,
    weekdays: [1],
    stayIds: [...menStays, ...womenStays],
  })

  // Single-cohort, and deliberately so — these are what prove the lanes still
  // carry lane-only events.
  await seedEvent({
    title: "Men's Process Group",
    location: 'Common room',
    cohorts: ['MEN'],
    at: '19:00',
    minutes: 90,
    weekdays: [2],
    stayIds: menStays,
  })

  await seedEvent({
    title: "Women's Process Group",
    location: 'Common room',
    cohorts: ['WOMEN'],
    at: '18:00',
    minutes: 90,
    weekdays: [4],
    stayIds: womenStays,
  })

  // A one-off, four days out, and both cohorts — so the shared band has a card
  // in the near-future DAY view and not only on Mondays. Also proof that ONCE
  // and WEEKLY are the same shape with a different rule.
  await seedEvent({
    title: 'Braves game — outing',
    description: 'Van leaves at ten. Sign the trip sheet.',
    location: 'Truist Park',
    cohorts: ['MEN', 'WOMEN'],
    at: '10:00',
    minutes: 300,
    startsOn: addDays(facilityToday(), 4),
    stayIds: [...menStays, ...womenStays],
  })

  /** A completed roll: every running occurrence stamped, marks split by cohort. */
  async function seedTakenRoll(occurrences, dateKey, marks) {
    for (const [cohort, occurrence] of Object.entries(occurrences)) {
      const session = await prisma.scheduleSession.create({
        data: {
          occurrenceId: occurrence.id,
          cohort,
          sessionDate: dateKeyToUtc(dateKey),
          attendanceTakenAt: new Date(),
          attendanceTakenById: tech.id,
        },
      })
      const mine = marks.filter((m) => cohortOfStay.get(m.stayId) === cohort)
      if (mine.length) {
        await prisma.scheduleAttendance.createMany({
          data: mine.map((m) => ({
            sessionId: session.id,
            cohort,
            stayId: m.stayId,
            status: m.status,
            note: m.note ?? null,
            recordedById: tech.id,
          })),
        })
      }
    }
  }

  // Yesterday's men's reflection: roll taken, one absence. Today's board opens
  // with a completed session and a resident with a mark on their record.
  const yesterday = addDays(facilityToday(), -1)
  await seedTakenRoll(
    { MEN: morningMen },
    yesterday,
    menStays.map((stayId, i) => ({
      stayId,
      status: i === 1 ? 'ABSENT' : 'ATTENDED',
      note: i === 1 ? 'Overslept. Spoken to.' : null,
    })),
  )

  // The most recent past Monday's house meeting, taken across BOTH cohorts —
  // so the shared band shows a completed card and not only pending ones. Both
  // sessions are stamped: under the merge's unanimity rule, stamping one side
  // would leave the card permanently MISSED and stuck in the queue.
  const lastMonday = (() => {
    let d = addDays(facilityToday(), -1)
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, -1)
    return d
  })()
  await seedTakenRoll(houseMeeting, lastMonday, [
    ...menStays.map((stayId) => ({ stayId, status: 'ATTENDED' })),
    ...womenStays.map((stayId, i) => ({
      stayId,
      status: i === 0 ? 'EXCUSED' : 'ATTENDED',
      note: i === 0 ? 'Work shift. Cleared in advance.' : null,
    })),
  ])

  // Two days ago is deliberately left with NO session row at all — that is what
  // an un-taken roll looks like, and it is what the board's queue is built
  // from. Nothing was written to make it appear; it is derived from its absence.

  console.log(`
  Seeded:
    ${await prisma.apartment.count()} apartments (1 men's, 1 women's)
    ${await prisma.bed.count()} beds (1 out of service)
    ${await prisma.resident.count()} residents (5 housed, 1 awaiting a bed, 1 discharged)
    ${await prisma.user.count()} staff users
    ${await prisma.maintenanceRequest.count()} maintenance requests (1 open urgent, 1 resolved)
    ${await prisma.signOut.count()} sign-outs (1 out, 1 OVERDUE, 1 returned)
    ${await prisma.apartmentCheck.count()} apartment checks (men's CHECKED with 1 not found, women's OVERDUE, 1 missed hour, 1 amended)
    ${await prisma.drugScreen.count()} drug screens (1 negative, 1 awaiting the resident's decision, 1 declined, 1 at the lab, 1 lab-cleared after paying)
    ${await prisma.ledgerEntry.count()} ledger entries (rent, laundry, a trip, a damage, one credit)
    ${await prisma.invoice.count()} invoices (1 paid, 1 three weeks overdue — past the dot's grace), the rest unbilled
    ${await prisma.scheduleEvent.count()} scheduled events (5 weekly, 1 one-off; 2 of them both cohorts), ${await prisma.scheduleOccurrence.count()} occurrences
    ${await prisma.scheduleAttendance.count()} attendance marks on 2 taken rolls (one of them shared) — earlier days left un-taken on purpose

  Any account you created with scripts/create-user.js was kept.

  Sign in with any of:
    admin@facility.test     (ADMIN)
    manager@facility.test   (HOUSE_MANAGER)
    tech@facility.test      (STAFF)
  Password for all three:   ${DEV_PASSWORD}
`)
  process.exit(0)
}

runAsSystem(main).catch((e) => {
  console.error(e)
  process.exit(1)
})
