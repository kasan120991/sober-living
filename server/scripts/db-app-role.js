/**
 * Grants LOGIN to the runtime database role and sets its password.
 *
 * The role itself is created by the RLS migration, deliberately without a
 * password — a credential in a migration is a credential in git. This script
 * takes it from APP_DB_PASSWORD in the environment, never from argv.
 *
 * Run once after `prisma migrate deploy`, and again whenever the password
 * rotates. Connects as the OWNER (DATABASE_URL), which is the only role that
 * can alter it.
 */
import 'dotenv/config'
import pg from 'pg'

async function main() {
  const password = process.env.APP_DB_PASSWORD
  if (!password) {
    throw new Error('Set APP_DB_PASSWORD in the environment. Do not pass it as an argument.')
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const { rows } = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'soberlife_app'`)
  if (!rows.length) {
    throw new Error('Role soberlife_app does not exist. Run `prisma migrate deploy` first.')
  }

  // Parameterised DDL is not supported, so the password is escaped as a literal.
  const literal = `'${password.replace(/'/g, "''")}'`
  await client.query(`ALTER ROLE soberlife_app LOGIN PASSWORD ${literal}`)

  // Belt and braces: these are the properties that would silently defeat RLS.
  await client.query(`ALTER ROLE soberlife_app NOSUPERUSER NOBYPASSRLS`)

  const { rows: check } = await client.query(
    `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'soberlife_app'`,
  )
  await client.end()

  const r = check[0]
  if (r.rolsuper || r.rolbypassrls) {
    throw new Error('soberlife_app can still bypass RLS. Refusing to report success.')
  }

  console.log(`
  soberlife_app  login=${r.rolcanlogin}  superuser=${r.rolsuper}  bypassrls=${r.rolbypassrls}

  Set APP_DATABASE_URL to connect as this role, e.g.
    APP_DATABASE_URL="postgresql://soberlife_app:<password>@localhost:5432/soberlife?schema=public"
`)
  process.exit(0)
}

main().catch((e) => {
  console.error(`\n  ${e.message}\n`)
  process.exit(1)
})
