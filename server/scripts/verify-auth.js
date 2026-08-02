/**
 * End-to-end auth checks against a live server + database.
 * Run after `node scripts/seed.js`.
 */
import { createApp } from '../src/app.js'

let pass = 0
let fail = 0
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++ }
const bad = (n, d) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`); fail++ }

const PW = 'soberlife-dev-1234'

async function main() {
  const server = createApp().listen(0)
  const base = `http://localhost:${server.address().port}`
  const call = (path, init) => fetch(base + path, init)

  console.log('\n\x1b[1mLogin\x1b[0m')

  const bad1 = await call('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@facility.test', password: 'wrong' }),
  })
  const bad1Body = await bad1.json()

  const bad2 = await call('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@facility.test', password: 'wrong' }),
  })
  const bad2Body = await bad2.json()

  bad1.status === 401 && bad2.status === 401
    ? ok('bad credentials are rejected with 401')
    : bad('bad credentials rejected', `${bad1.status} / ${bad2.status}`)

  bad1Body.error === bad2Body.error
    ? ok(`unknown email and wrong password give the SAME message ("${bad1Body.error}")`)
    : bad('login is not an account-existence oracle', `"${bad1Body.error}" vs "${bad2Body.error}"`)

  const good = await call('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@facility.test', password: PW }),
  })
  const goodBody = await good.json()
  good.status === 200 && goodBody.user?.role === 'ADMIN'
    ? ok('valid credentials sign in and return the user')
    : bad('valid credentials sign in', JSON.stringify(goodBody))

  const setCookie = good.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0]

  const named = cookie.startsWith('sl_session=')
  const httpOnly = /HttpOnly/i.test(setCookie)
  const sameSite = /SameSite=Lax/i.test(setCookie)
  const noLifetime = !/Max-Age|Expires/i.test(setCookie)

  named ? ok('a session cookie is issued') : bad('session cookie issued', setCookie)
  httpOnly ? ok('cookie is HttpOnly') : bad('cookie is HttpOnly', setCookie)
  sameSite ? ok('cookie is SameSite=Lax') : bad('cookie is SameSite', setCookie)
  noLifetime
    ? ok('cookie is a session cookie (no Max-Age) — lifetime is server-side')
    : bad('cookie has no client-side lifetime', setCookie)

  const token = cookie.split('=')[1]
  !goodBody.token && !JSON.stringify(goodBody).includes(token)
    ? ok('the session token is not echoed in the response body')
    : bad('token not in body', JSON.stringify(goodBody))

  console.log('\n\x1b[1mSession\x1b[0m')

  const meAnon = await call('/auth/me')
  meAnon.status === 401 ? ok('/auth/me requires a session') : bad('/auth/me requires auth', meAnon.status)

  const me = await call('/auth/me', { headers: { cookie } })
  const meBody = await me.json()
  me.status === 200 && meBody.user?.role === 'ADMIN'
    ? ok('/auth/me returns the signed-in user')
    : bad('/auth/me returns user', JSON.stringify(meBody))

  const forged = await call('/auth/me', { headers: { cookie: 'sl_session=not-a-real-token' } })
  forged.status === 401 ? ok('a forged cookie is rejected') : bad('forged cookie rejected', forged.status)

  console.log('\n\x1b[1mLogout\x1b[0m')

  const out = await call('/auth/logout', { method: 'POST', headers: { cookie } })
  out.status === 204 ? ok('logout succeeds') : bad('logout succeeds', out.status)

  const after = await call('/auth/me', { headers: { cookie } })
  after.status === 401
    ? ok('the session is dead server-side after logout (cookie replay fails)')
    : bad('session revoked server-side', after.status)

  console.log('\n\x1b[1mAudit\x1b[0m')

  const { prisma } = await import('../src/db/client.js')
  const logins = await prisma.auditLog.count({ where: { action: 'LOGIN' } })
  const failures = await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })
  logins >= 1 && failures >= 2
    ? ok(`logins and failures are audited (${logins} LOGIN, ${failures} LOGIN_FAILED)`)
    : bad('login attempts audited', `${logins} LOGIN, ${failures} LOGIN_FAILED`)

  const withPhi = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM "audit_log"
     WHERE "userAgent" ILIKE '%@%' OR "entity" ILIKE '%@%'`)
  withPhi[0].n === 0
    ? ok('no email addresses leaked into audit rows')
    : bad('audit rows contain no PHI', `${withPhi[0].n} suspicious rows`)

  console.log(`\n\x1b[1mResult: ${pass} passed, ${fail} failed\x1b[0m\n`)
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
