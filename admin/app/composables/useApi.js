/**
 * The single door to the API.
 *
 * The session is an httpOnly cookie the browser attaches automatically — no
 * code here ever sees a token. `credentials: 'include'` is what carries it
 * cross-origin, which is why CORS is pinned to an explicit origin list on the
 * server rather than a wildcard.
 */
export function useApi() {
  const config = useRuntimeConfig()

  return (path, options = {}) =>
    $fetch(path, {
      baseURL: config.public.apiBase,
      credentials: 'include',
      ...options,
    })
}
