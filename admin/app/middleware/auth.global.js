import { STAFF_APP_ROLES } from '~/utils/roles.js'

/**
 * Redirects to /login when there is no session, and keeps non-staff out of the
 * staff app entirely.
 *
 * Presentation only — the API authorizes every request independently. See
 * CLAUDE.md: client-side hiding is never protection. This exists so a RESIDENT
 * account cannot land in staff chrome at all, rather than landing there and
 * having every request refused.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, refresh, signOut } = useAuth()

  if (user.value === null) await refresh()

  const isLogin = to.path === '/login'

  if (!user.value) return isLogin ? undefined : navigateTo('/login')

  // Signed in, but not with a staff role: end the session rather than leaving a
  // resident sitting on a staff URL with a live cookie.
  if (!STAFF_APP_ROLES.includes(user.value.role)) {
    await signOut()
    return
  }

  if (isLogin) return navigateTo('/')
})
