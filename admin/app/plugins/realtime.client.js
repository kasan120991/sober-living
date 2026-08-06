/**
 * Connects the invalidation socket for the life of the signed-in session.
 *
 * Keyed off auth state rather than a page: the socket belongs to the session,
 * not to any screen. `immediate` covers the hard-refresh case where
 * auth.global.js restored the user before this watcher existed.
 */
export default defineNuxtPlugin(() => {
  const { user } = useAuth()
  const { connect, disconnect } = useRealtime()

  watch(user, (u) => (u ? connect() : disconnect()), { immediate: true })
})
