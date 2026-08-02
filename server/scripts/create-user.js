/**
 * Create or update a staff account.
 *
 *   USER_PASSWORD='...' node scripts/create-user.js \
 *     --email you@example.com --name "Your Name" --role ADMIN
 *
 * The password is read from the environment on purpose — never as an argv flag,
 * which would put it in shell history and in `ps` output for any other user on
 * the machine. It is never written to a file and never logged.
 *
 * Idempotent: re-running updates the existing account rather than failing, so
 * this can be re-run after `seed.js` (which truncates `users`).
 */
import { prisma } from '../src/db/client.js'
import { hashPassword } from '../src/auth/passwords.js'
import { STAFF_ROLE } from '../src/domain/constants.js'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const email = arg('email')?.trim().toLowerCase()
  const fullName = arg('name')?.trim()
  const role = (arg('role') ?? STAFF_ROLE.ADMIN).trim().toUpperCase()
  const password = process.env.USER_PASSWORD

  if (!email || !fullName) {
    throw new Error('Usage: --email <email> --name "<full name>" [--role ADMIN]')
  }
  if (!password) {
    throw new Error('Set USER_PASSWORD in the environment. Do not pass it as an argument.')
  }
  if (!Object.values(STAFF_ROLE).includes(role)) {
    throw new Error(`--role must be one of: ${Object.values(STAFF_ROLE).join(', ')}`)
  }
  if (role === STAFF_ROLE.RESIDENT) {
    throw new Error('RESIDENT accounts are created through intake, not this script.')
  }
  // NIST SP 800-63B: 8 character minimum, and no composition rules (no forced
  // symbol/digit classes — they push people toward predictable substitutions).
  // Length is the property that matters; argon2id handles the rest.
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }

  const passwordHash = await hashPassword(password)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      fullName,
      role,
      isActive: true,
      deletedAt: null,
      // A password change clears any lockout.
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: { email, passwordHash, fullName, role },
  })

  // Changing a password must not leave old sessions alive on other devices.
  const { count } = await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'password changed' },
  })

  console.log(`\n  ${user.email}  ${user.fullName}  ${user.role}`)
  console.log(`  ${count} existing session(s) revoked`)
  console.log('  Password set (not echoed).\n')
  process.exit(0)
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
