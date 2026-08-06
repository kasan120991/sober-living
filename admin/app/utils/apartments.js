/**
 * Apartment naming: staff type the number, every screen says "Apt 12".
 *
 * The database stores the full name — the API contract is unchanged and the
 * server does not care. The convention lives here, in the two dialogs that
 * write names, so typing "12", "apt 12" or "Apt 12" all land as "Apt 12"
 * rather than "Apt Apt 12".
 */
export function toApartmentName(number) {
  return `Apt ${apartmentNumber(number)}`
}

/** The part staff type: "Apt 12" → "12". Tolerates a missing prefix. */
export function apartmentNumber(name) {
  return String(name ?? '').trim().replace(/^apt\.?\s*/i, '')
}
