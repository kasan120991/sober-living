/**
 * Session state for the admin app.
 *
 * The session token is an httpOnly cookie the browser sends automatically —
 * this composable never sees or stores it. `credentials: 'include'` is what
 * carries it cross-origin to the API, which is why CORS is pinned to an
 * explicit origin list server-side rather than a wildcard.
 *
 * Nothing here is a security boundary. Hiding a route in the client is
 * presentation; the API authorizes every request regardless.
 */
export function useAuth() {
  const user = useState('auth.user', () => null)
  const config = useRuntimeConfig()
  const api = (path, options = {}) =>
    $fetch(path, { baseURL: config.public.apiBase, credentials: 'include', ...options })

  async function signIn(email, password) {
    const { user: signedIn } = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    user.value = signedIn
    return signedIn
  }

  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      await navigateTo('/login')
    }
  }

  /** Restores session state on boot, and after a hard refresh. */
  async function refresh() {
    try {
      const { user: me } = await api('/auth/me')
      user.value = me
    } catch {
      user.value = null
    }
    return user.value
  }

  return { user, signIn, signOut, refresh }
}
