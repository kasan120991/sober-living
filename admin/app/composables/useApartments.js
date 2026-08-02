/**
 * Apartments, beds and maintenance.
 *
 * Every mutation refetches rather than patching local state. Occupancy is
 * derived on the server from live bed assignments, so a client-side guess would
 * be a second source of truth for the one number the census depends on.
 */
export function useApartments() {
  const api = useApi()

  const listApartments = () => api('/apartments').then((r) => r.apartments)
  const getApartment = (id) => api(`/apartments/${id}`)

  const createApartment = (body) => api('/apartments', { method: 'POST', body })
  const updateApartment = (id, body) => api(`/apartments/${id}`, { method: 'PATCH', body })
  const removeApartment = (id) => api(`/apartments/${id}`, { method: 'DELETE' })

  /** Bulk: `{ count, scheme }`. Single: `{ label }`. Never both. */
  const addBeds = (apartmentId, body) =>
    api(`/apartments/${apartmentId}/beds`, { method: 'POST', body })
  const updateBed = (id, body) => api(`/beds/${id}`, { method: 'PATCH', body })
  const removeBed = (id) => api(`/beds/${id}`, { method: 'DELETE' })

  const listRequests = (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== ''),
    ).toString()
    return api(`/maintenance${qs ? `?${qs}` : ''}`).then((r) => r.requests)
  }
  const createRequest = (body) => api('/maintenance', { method: 'POST', body })
  const updateRequest = (id, body) => api(`/maintenance/${id}`, { method: 'PATCH', body })

  return {
    listApartments,
    getApartment,
    createApartment,
    updateApartment,
    removeApartment,
    addBeds,
    updateBed,
    removeBed,
    listRequests,
    createRequest,
    updateRequest,
  }
}

/** Preview the labels a bulk create will produce, before committing to them. */
export function previewLabels(scheme, count, existing = []) {
  const taken = new Set(existing.map((l) => String(l).toUpperCase()))
  const sorted = [...taken].sort()
  const last = sorted[sorted.length - 1] ?? null
  const out = []
  if (scheme === 'numeric') {
    const start = last && !Number.isNaN(Number(last)) ? Number(last) + 1 : 1
    for (let i = 0; i < count; i++) out.push(String(start + i))
  } else {
    const startIndex = last && /^[A-Z]$/.test(last) ? last.charCodeAt(0) - 64 : 0
    for (let i = 0; i < count; i++) out.push(String.fromCharCode(65 + startIndex + i))
  }
  return out
}
