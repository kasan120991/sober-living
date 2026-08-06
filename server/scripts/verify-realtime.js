/**
 * Realtime invalidation — end to end against a real socket server.
 *
 * What this proves, in order of importance:
 *   1. The handshake is a gate: no session, a garbage cookie, and a RESIDENT
 *      session are all refused. The census by name must never fan out to a
 *      resident's device, and the payload rule only matters if the gate holds.
 *   2. The payload carries nothing: `at` and only `at`. The moment a domain
 *      string appears here, the socket has become a data channel and RLS no
 *      longer covers what it carries.
 *   3. Emission discipline: mutations signal, reads and failures stay silent,
 *      bursts coalesce, and /auth never broadcasts.
 *   4. Logout drops the session's sockets and its cookie cannot reconnect.
 *
 * Run after `node scripts/seed.js`. Leaves behind one maintenance request and
 * a RESIDENT probe account (cleaned by the next seed — reset removes every
 * `.test` login).
 */
import { spawnSync } from 'node:child_process'
import { io as ioc } from 'socket.io-client'

import { createApp } from '../src/app.js'
import { initRealtime, closeRealtime, COALESCE_MS } from '../src/lib/realtime.js'

let pass = 0
let fail = 0
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++ }
const bad = (n, d) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`); fail++ }
const PW = 'soberlife-dev-1234'
const PROBE_EMAIL = 'resident.probe@facility.test'

// Long enough for one coalesce window to open and close, plus slack.
const WAIT_MS = COALESCE_MS * 6

const waitFor = (socket, event, ms = WAIT_MS) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), ms)
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload) })
  })

/** Resolves with how many times `event` fired inside the window. */
const countEvents = (socket, event, ms = WAIT_MS) =>
  new Promise((resolve) => {
    let n = 0
    const h = () => { n += 1 }
    socket.on(event, h)
    setTimeout(() => { socket.off(event, h); resolve(n) }, ms)
  })

function connectSocket(base, cookie) {
  return ioc(base, {
    withCredentials: true,
    reconnection: false,
    ...(cookie ? { extraHeaders: { cookie } } : {}),
  })
}

/** Handshake outcome as a value: 'connected' or the connect_error message. */
const handshake = (socket) =>
  new Promise((resolve) => {
    socket.once('connect', () => resolve('connected'))
    socket.once('connect_error', (err) => resolve(err.message))
  })

async function main() {
  // The RESIDENT probe account, forged as the owner in a child process so this
  // process's app keeps running on the app role. Login itself is allowed for a
  // resident — the socket handshake is what must refuse them.
  const forge = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
      import './scripts/lib/as-owner.js'
      const { prisma } = await import('./src/db/client.js')
      const { runAsSystem } = await import('./src/lib/dbContext.js')
      const { hashPassword } = await import('./src/auth/passwords.js')
      await runAsSystem(async () => {
        const passwordHash = await hashPassword(${JSON.stringify(PW)})
        await prisma.user.upsert({
          where: { email: ${JSON.stringify(PROBE_EMAIL)} },
          update: { role: 'RESIDENT', isActive: true, passwordHash },
          create: {
            email: ${JSON.stringify(PROBE_EMAIL)},
            fullName: 'Resident Probe',
            role: 'RESIDENT',
            passwordHash,
          },
        })
      })
      process.exit(0)
      `,
    ],
    { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' },
  )
  if (forge.status !== 0) {
    console.error('Could not forge the RESIDENT probe account:')
    console.error(String(forge.stderr))
    process.exit(1)
  }

  const server = createApp().listen(0)
  initRealtime(server)
  const base = `http://localhost:${server.address().port}`

  async function login(email) {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PW }),
    })
    return (r.headers.get('set-cookie') ?? '').split(';')[0]
  }
  const as = (cookie) => async (path, init = {}) => {
    const r = await fetch(base + path, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
    })
    const body = r.status === 204 ? null : await r.json().catch(() => null)
    return { status: r.status, body }
  }

  console.log('\n\x1b[1mThe handshake is a gate\x1b[0m')

  const anon = connectSocket(base)
  ;(await handshake(anon)) === 'unauthorized'
    ? ok('no cookie is refused')
    : bad('anonymous refused', 'connected or wrong error')
  anon.disconnect()

  const garbage = connectSocket(base, 'sl_session=not-a-real-token')
  ;(await handshake(garbage)) === 'unauthorized'
    ? ok('a garbage cookie is refused')
    : bad('garbage cookie refused', 'connected or wrong error')
  garbage.disconnect()

  const residentCookie = await login(PROBE_EMAIL)
  const residentSocket = connectSocket(base, residentCookie)
  ;(await handshake(residentSocket)) === 'unauthorized'
    ? ok('a RESIDENT session is refused — a valid login is not enough')
    : bad('resident refused', 'a resident device joined the staff fan-out')
  residentSocket.disconnect()

  const techCookie = await login('tech@facility.test')
  const tech = as(techCookie)
  const techSocket = connectSocket(base, techCookie)
  ;(await handshake(techSocket)) === 'connected'
    ? ok('a staff session connects')
    : bad('staff connects', 'handshake refused')

  console.log('\n\x1b[1mThe payload carries nothing\x1b[0m')

  const { body: aptsBody } = await tech('/apartments')
  const aptId = aptsBody?.apartments?.[0]?.id
  const changed = waitFor(techSocket, 'changed')
  const filed = await tech('/maintenance', {
    method: 'POST',
    body: JSON.stringify({ apartmentId: aptId, title: 'Realtime probe — hallway bulb out' }),
  })
  let payload = null
  try {
    payload = await changed
    ok('a staff mutation broadcasts `changed`')
  } catch {
    bad('mutation broadcasts', `POST /maintenance was ${filed.status}, no event followed`)
  }

  const keys = Object.keys(payload ?? {})
  keys.every((k) => k === 'at')
    ? ok('payload keys are exactly [at]')
    : bad('payload shape', JSON.stringify(keys))

  const serialized = JSON.stringify(payload ?? {})
  !serialized.includes(aptId) && !serialized.includes('bulb')
    ? ok('payload contains no ids and no domain text')
    : bad('payload leaks', serialized)

  console.log('\n\x1b[1mEmission discipline\x1b[0m')

  await tech('/census')
  ;(await countEvents(techSocket, 'changed')) === 0
    ? ok('a read broadcasts nothing')
    : bad('read is silent', 'GET /census produced an event')

  const rejected = await tech('/maintenance', { method: 'POST', body: JSON.stringify({}) })
  const afterFail = await countEvents(techSocket, 'changed')
  rejected.status === 400 && afterFail === 0
    ? ok('a failed mutation broadcasts nothing')
    : bad('failure is silent', `status ${rejected.status}, ${afterFail} event(s)`)

  const burstCount = countEvents(techSocket, 'changed', COALESCE_MS * 8)
  await Promise.all([
    tech('/maintenance', {
      method: 'POST',
      body: JSON.stringify({ apartmentId: aptId, title: 'Realtime probe — burst A' }),
    }),
    tech('/maintenance', {
      method: 'POST',
      body: JSON.stringify({ apartmentId: aptId, title: 'Realtime probe — burst B' }),
    }),
  ])
  ;(await burstCount) === 1
    ? ok('a burst of writes coalesces to one event')
    : bad('coalescing', `expected 1 event`)

  console.log('\n\x1b[1mSessions end, sockets end\x1b[0m')

  // Watched from a second socket, because the first is about to die with its
  // session.
  const managerSocket = connectSocket(base, await login('manager@facility.test'))
  await handshake(managerSocket)

  const authQuiet = countEvents(managerSocket, 'changed')
  await login('admin@facility.test')
  ;(await authQuiet) === 0
    ? ok('a login broadcasts nothing')
    : bad('/auth is silent', 'login produced an event')

  const dropped = waitFor(techSocket, 'disconnect', WAIT_MS * 2)
  const logoutQuiet = countEvents(managerSocket, 'changed')
  await tech('/auth/logout', { method: 'POST' })
  try {
    await dropped
    ok('logout disconnects that session’s socket')
  } catch {
    bad('logout disconnects', 'socket still connected after logout')
  }
  ;(await logoutQuiet) === 0
    ? ok('a logout broadcasts nothing')
    : bad('logout is silent', 'logout produced an event')

  const reuse = connectSocket(base, techCookie)
  ;(await handshake(reuse)) === 'unauthorized'
    ? ok('the logged-out cookie cannot reconnect')
    : bad('revoked cookie refused', 'reconnected with a revoked session')
  reuse.disconnect()

  techSocket.disconnect()
  managerSocket.disconnect()
  await closeRealtime()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
