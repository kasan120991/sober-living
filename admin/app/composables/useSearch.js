/**
 * Global search, for the header field.
 *
 * The query is never persisted, never put in a URL, and never logged — it is
 * somebody's name. It lives in a ref for as long as the dialog is open and is
 * cleared when it closes.
 */
export function useSearch() {
  const api = useApi()

  /** @param {string} q  @returns {Promise<{residents:[],apartments:[],tooShort:boolean}>} */
  const search = (q) => api(`/search?q=${encodeURIComponent(q)}`)

  return { search }
}
