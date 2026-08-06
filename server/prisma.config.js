// Prisma 7 moved the migration connection URL out of schema.prisma and into
// this file. Note it does NOT auto-load .env — dotenv is loaded explicitly.
import 'dotenv/config'
import { defineConfig } from '@prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Used by the CLI only: migrate, db push, studio.
    // The runtime connection goes through the driver adapter in src/db/client.js.
    //
    // `process.env` rather than @prisma/config's `env()` — the same shape
    // `prisma init` generates — because `env()` THROWS the moment the config
    // is loaded if the variable is missing, and the config is loaded for every
    // command. `prisma generate` does not need a datasource at all (only
    // `generate --sql` does), so the eager throw broke the postinstall hook on
    // a fresh clone: npm install ran before anyone had copied .env.
    // Commands that DO need it still fail, just at connection time.
    url: process.env.DATABASE_URL,
  },
})
