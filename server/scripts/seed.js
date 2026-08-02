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

  // Phase privileges are deliberately left null — facility policy, not ours to
  // invent. See CLAUDE.md.
  // Orientation is level 0: the restricted first stretch before Phase 1. It is a
  // Program row rather than a separate status field, so intake picks a standing
  // and a phase from one list instead of two concepts meaning nearly the same.
  const [orientation, phase1, phase2] = await Promise.all([
    prisma.program.create({ data: { name: 'Orientation', level: 0 } }),
    prisma.program.create({ data: { name: 'Phase 1', level: 1 } }),
    prisma.program.create({ data: { name: 'Phase 2', level: 2 } }),
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

  console.log(`
  Seeded:
    ${await prisma.apartment.count()} apartments (1 men's, 1 women's)
    ${await prisma.bed.count()} beds (1 out of service)
    ${await prisma.resident.count()} residents (5 housed, 1 awaiting a bed, 1 discharged)
    ${await prisma.user.count()} staff users
    ${await prisma.maintenanceRequest.count()} maintenance requests (1 open urgent, 1 resolved)
    ${await prisma.ledgerEntry.count()} ledger entries (rent, laundry, a trip, a damage, one credit)

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
