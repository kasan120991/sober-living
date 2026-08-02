/**
 * Redirects to /login when there is no session. Presentation only — the API
 * authorizes every request independently. See CLAUDE.md: client-side hiding is
 * never protection.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, refresh } = useAuth()

  if (user.value === null) await refresh()

  const isLogin = to.path === '/login'
  if (!user.value && !isLogin) return navigateTo('/login')
  if (user.value && isLogin) return navigateTo('/')
})
