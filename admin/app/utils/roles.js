/**
 * Mirrors the StaffRole enum in server/prisma/schema.prisma and the constants in
 * server/src/domain/constants.js.
 *
 * Copied, not imported — admin/ and server/ share tokens and vocabulary, never
 * code. See CLAUDE.md on why the frontends stay independent.
 */
export const STAFF_ROLE = Object.freeze({
  ADMIN: 'ADMIN',
  HOUSE_MANAGER: 'HOUSE_MANAGER',
  STAFF: 'STAFF',
  RESIDENT: 'RESIDENT',
})

/** Roles permitted to use the staff app at all. RESIDENT is deliberately absent. */
export const STAFF_APP_ROLES = Object.freeze([
  STAFF_ROLE.ADMIN,
  STAFF_ROLE.HOUSE_MANAGER,
  STAFF_ROLE.STAFF,
])

/** Human-readable role, for the user menu. */
export function roleLabel(role) {
  return (
    {
      [STAFF_ROLE.ADMIN]: 'Administrator',
      [STAFF_ROLE.HOUSE_MANAGER]: 'House manager',
      [STAFF_ROLE.STAFF]: 'Staff',
      [STAFF_ROLE.RESIDENT]: 'Resident',
    }[role] ?? role
  )
}

/** Initials for the avatar fallback. */
export function initialsOf(fullName) {
  if (!fullName) return '?'
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}
