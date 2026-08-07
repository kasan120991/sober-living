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

  // A page may name the roles that can OPEN it, via `definePageMeta({ roles })`.
  // Presentation, like everything else here — the API refuses the data
  // regardless, and that refusal is the protection.
  //
  // It exists because /billing is the first page whose READ is manager-only.
  // Every earlier manager-gated page (/apartments, /staff) has an all-staff GET
  // behind it and only gates the writes, so a tech typing the URL got a page
  // that simply rendered. Typing /billing without this got a 500 from the
  // refused fetch — a crash where a redirect belongs.
  if (to.meta.roles && !to.meta.roles.includes(user.value.role)) return navigateTo('/')
})
