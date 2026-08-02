import { Router } from 'express'

const router = Router()

/**
 * Deliberately says nothing about the database, schema, or version. A health
 * endpoint is unauthenticated, so it must not become a reconnaissance surface.
 */
router.get('/', (_req, res) => {
  res.json({ status: 'ok' })
})

export default router
