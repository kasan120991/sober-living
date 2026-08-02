/**
 * Makes a script connect as the database OWNER rather than the runtime role.
 *
 * MUST be imported before ../src/db/client.js — ESM evaluates imports in order,
 * and the client reads these variables at module load.
 *
 * Two kinds of script need this:
 *   - Setup (seed): TRUNCATE is deliberately not granted to the app role.
 *   - Constraint tests: they verify triggers and indexes hold against someone
 *     with direct database access, so running them as the app role would
 *     conflate "permission denied" with "the trigger fired".
 *
 * FORCE ROW LEVEL SECURITY still applies to the owner, so these scripts must
 * also wrap their work in runAsSystem().
 */
import 'dotenv/config'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set.')
}
process.env.APP_DATABASE_URL = process.env.DATABASE_URL
