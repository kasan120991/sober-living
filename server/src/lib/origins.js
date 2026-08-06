/**
 * The allowed browser origins, from CORS_ORIGINS. One parser, used by both the
 * HTTP CORS middleware and the Socket.IO server, so the two lists cannot drift
 * — a socket origin the API refuses (or vice versa) would be a policy written
 * in two places disagreeing.
 */
export function corsOrigins() {
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
