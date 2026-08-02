import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'

import { requestContextMiddleware } from './lib/requestContext.js'
import { sessionMiddleware } from './middleware/session.js'
import { dbActorMiddleware } from './middleware/dbActor.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import apartmentsRouter from './routes/apartments.js'
import bedsRouter from './routes/beds.js'
import maintenanceRouter from './routes/maintenance.js'
import residentsRouter from './routes/residents.js'

export function createApp() {
  const app = express()

  // Behind a proxy in production — needed for req.ip to be the real client.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(helmet())

  // Explicit origin list, credentials on. No wildcard: the two frontends are
  // the only clients, and the session rides on an httpOnly cookie.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  app.use(cors({ origin: origins, credentials: true }))

  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(requestContextMiddleware)
  app.use(sessionMiddleware)
  // After the session: what the database may show is derived from the verified
  // session, never from the request.
  app.use(dbActorMiddleware)

  app.use('/health', healthRouter)
  app.use('/auth', authRouter)

  // Everything below is authenticated. See middleware/authorize.js — no route
  // is public by default.
  app.use('/apartments', apartmentsRouter)
  app.use('/beds', bedsRouter)
  app.use('/maintenance', maintenanceRouter)
  app.use('/residents', residentsRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
