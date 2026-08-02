// Prisma 7 moved the migration connection URL out of schema.prisma and into
// this file. Note it does NOT auto-load .env — dotenv is loaded explicitly.
import 'dotenv/config'
import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Used by the CLI only: migrate, db push, studio.
    // The runtime connection goes through the driver adapter in src/db/client.js.
    url: env('DATABASE_URL'),
  },
})
