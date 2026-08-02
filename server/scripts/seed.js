/**
 * Development seed. Looks like a real facility, per CLAUDE.md: apartments in
 * both cohorts, a full-ish census, someone out on pass, one overdue sign-out
 * (once those tables exist).
 *
 * Passwords here are development-only and printed to the console on purpose.
 * Never run this against production.
 */
import { prisma } from '../src/db/client.js'
import { hashPassword } from '../src/auth/passwords.js'

const DEV_PASSWORD = 'soberlife-dev-1234'

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.')
  }

  console.log('Seeding…')
  await prisma.$executeRawUnsafe(`
    TRUNCATE "sessions","bed_assignments","stays","documents","emergency_contacts",
             "beds","apartments","residents","users","programs"
    RESTART IDENTITY CASCADE`)

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
  const [phase1, phase2] = await Promise.all([
    prisma.program.create({ data: { name: 'Phase 1', level: 1 } }),
    prisma.program.create({ data: { name: 'Phase 2', level: 2 } }),
  ])

  const tz = 'America/Chicago'
  const apt12 = await prisma.apartment.create({
    data: { name: 'Apt 12', cohort: 'MEN', timezone: tz, city: 'Austin', state: 'TX' },
  })
  const apt14 = await prisma.apartment.create({
    data: { name: 'Apt 14', cohort: 'WOMEN', timezone: tz, city: 'Austin', state: 'TX' },
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
    { first: 'Andre', last: 'Whitfield', cohort: 'MEN', bed: mensBeds[0], program: phase2 },
    { first: 'Danny', last: 'Ocampo', cohort: 'MEN', bed: mensBeds[1], program: phase1 },
    { first: 'Ruben', last: 'Castillo', cohort: 'MEN', bed: mensBeds[2], program: phase1 },
    { first: 'Tasha', last: 'Boone', cohort: 'WOMEN', bed: womensBeds[0], program: phase2 },
    { first: 'Marisol', last: 'Ferrer', cohort: 'WOMEN', bed: womensBeds[1], program: phase1 },
  ]

  for (const p of people) {
    const resident = await prisma.resident.create({
      data: { firstName: p.first, lastName: p.last, cohort: p.cohort },
    })
    const stay = await prisma.stay.create({
      data: {
        residentId: resident.id,
        cohort: p.cohort,
        programId: p.program.id,
        intakeAt: new Date('2026-05-01T15:00:00Z'),
        expectedDischargeAt: new Date('2026-11-01T15:00:00Z'),
        referralSource: 'Travis County drug court',
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
  }

  console.log(`
  Seeded:
    ${await prisma.apartment.count()} apartments (1 men's, 1 women's)
    ${await prisma.bed.count()} beds (1 out of service)
    ${await prisma.resident.count()} residents, all with an active bed
    ${await prisma.user.count()} staff users

  Sign in with any of:
    admin@facility.test     (ADMIN)
    manager@facility.test   (HOUSE_MANAGER)
    tech@facility.test      (STAFF)
  Password for all three:   ${DEV_PASSWORD}
`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
