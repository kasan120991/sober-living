import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'

import { requestContextMiddleware } from './lib/requestContext.js'
import { corsOrigins } from './lib/origins.js'
import { broadcastChanged } from './lib/realtime.js'
import { sessionMiddleware } from './middleware/session.js'
import { dbActorMiddleware } from './middleware/dbActor.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import apartmentsRouter from './routes/apartments.js'
import bedsRouter from './routes/beds.js'
import maintenanceRouter from './routes/maintenance.js'
import notificationsRouter from './routes/notifications.js'
import searchRouter from './routes/search.js'
import residentsRouter from './routes/residents.js'
import censusRouter from './routes/census.js'
import dashboardRouter from './routes/dashboard.js'
import signOutsRouter from './routes/signOuts.js'
import scheduleRouter from './routes/schedule.js'
import serviceRouter from './routes/service.js'
import checksRouter from './routes/checks.js'
import screensRouter from './routes/screens.js'
import medsRouter from './routes/meds.js'
import passesRouter from './routes/passes.js'
import staffRouter from './routes/staff.js'
import invoicesRouter from './routes/invoices.js'
import billingRouter from './routes/billing.js'
import stripeWebhookRouter from './routes/stripeWebhook.js'

export function createApp() {
  const app = express()

  // Behind a proxy in production — needed for req.ip to be the real client.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(helmet())

  // Explicit origin list, credentials on. No wildcard: the two frontends are
  // the only clients, and the session rides on an httpOnly cookie. Shared with
  // the Socket.IO server — see lib/origins.js.
  app.use(cors({ origin: corsOrigins(), credentials: true }))

  // Stripe signs the EXACT bytes it sent, so its webhook needs the raw buffer.
  // express.json parses and discards them, and a signature checked against a
  // re-serialised object is a check against a different string.
  //
  // Path-scoped and ABOVE the global parser: body-parser sets `req._body` once
  // a body has been read, and every other body-parser skips a request carrying
  // it — so the JSON parser below leaves this one route alone by construction.
  // Rejected the alternative, express.json({ verify }), because it would
  // buffer a copy of EVERY request body in the process to serve one URL.
  app.use('/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  // Realtime invalidation: any successful mutation, on any route present or
  // future, tells every connected staff screen to refetch. `finish` fires
  // after the response left, which is after the route awaited its transaction
  // — a client's refetch can never observe pre-commit state. /auth is skipped:
  // login and logout change nothing another screen shows, and broadcasting on
  // login would announce sign-in cadence for no benefit.
  //
  // req.originalUrl, not req.path: Express rewrites req.path when descending
  // into mounted routers, and at finish time it may be router-relative.
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
      if (res.statusCode >= 400) return
      if (req.originalUrl.split('?')[0].startsWith('/auth')) return
      broadcastChanged()
    })
    next()
  })
  app.use(requestContextMiddleware)

  // ABOVE sessionMiddleware, deliberately: the webhook has no cookie, and
  // mounting it here makes "this route is not session-authenticated"
  // structural rather than incidental — no forged cookie can establish an
  // actor for it. Its signature check is its authentication.
  app.use('/stripe/webhook', stripeWebhookRouter)

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
  app.use('/notifications', notificationsRouter)
  app.use('/search', searchRouter)
  app.use('/residents', residentsRouter)
  app.use('/census', censusRouter)
  app.use('/dashboard', dashboardRouter)
  app.use('/sign-outs', signOutsRouter)
  app.use('/schedule', scheduleRouter)
  app.use('/service', serviceRouter)
  app.use('/checks', checksRouter)
  app.use('/screens', screensRouter)
  app.use('/meds', medsRouter)
  app.use('/passes', passesRouter)
  app.use('/staff', staffRouter)
  app.use('/invoices', invoicesRouter)
  // Managers and admins only — the gate lives on the router itself.
  app.use('/billing', billingRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
