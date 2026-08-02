import { STAFF_ROLE } from '~/utils/roles.js'

/**
 * Sidebar navigation, filtered by role.
 *
 * Filtering here is PRESENTATION ONLY. Hiding a link does not protect the route
 * behind it — `server/src/middleware/authorize.js` authorizes every request
 * independently, and it is the only thing that actually holds. See CLAUDE.md.
 *
 * Grouped by how staff work rather than by CLAUDE.md's build order: the things a
 * tech touches on shift sit together, and facility configuration is separated
 * out because it is visited rarely.
 */

const ALL_STAFF = [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER, STAFF_ROLE.STAFF]
const MANAGERS = [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER]
const ADMIN_ONLY = [STAFF_ROLE.ADMIN]

const GROUPS = [
  {
    id: 'main',
    items: [
      // Labelled "Home" in the nav, though the page itself is the census board.
      // The nav says where you go; the page says what it is.
      { label: 'Home', icon: 'i-lucide-house', to: '/', roles: ALL_STAFF },
      { label: 'Residents', icon: 'i-lucide-users', to: '/residents', roles: ALL_STAFF },
    ],
  },
  {
    id: 'daily',
    label: 'Daily',
    items: [
      { label: 'Apartment checks', icon: 'i-lucide-clipboard-check', to: '/checks', roles: ALL_STAFF },
      { label: 'Drug screens', icon: 'i-lucide-flask-conical', to: '/screens', roles: ALL_STAFF },
      { label: 'Med pass', icon: 'i-lucide-pill', to: '/meds', roles: ALL_STAFF },
      { label: 'Sign-outs', icon: 'i-lucide-door-open', to: '/sign-outs', roles: ALL_STAFF },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    items: [
      { label: 'Schedule', icon: 'i-lucide-calendar-days', to: '/schedule', roles: ALL_STAFF },
      { label: 'Travel passes', icon: 'i-lucide-plane', to: '/passes', roles: ALL_STAFF },
      { label: 'Community service', icon: 'i-lucide-hand-heart', to: '/service', roles: ALL_STAFF },
    ],
  },
  {
    id: 'facility',
    label: 'Facility',
    items: [
      { label: 'Apartments & Beds', icon: 'i-lucide-building-2', to: '/apartments', roles: MANAGERS },
      { label: 'Staff', icon: 'i-lucide-id-card', to: '/staff', roles: ADMIN_ONLY },
      { label: 'Audit log', icon: 'i-lucide-scroll-text', to: '/audit', roles: ADMIN_ONLY },
    ],
  },
]

export function useNavigation() {
  const { user } = useAuth()

  /**
   * `UNavigationMenu` takes an array of arrays and draws a divider between each.
   * A `type: 'label'` entry gives the group its heading; the dividers still
   * separate the groups once railed, where labels are hidden.
   *
   * @param {boolean} collapsed — drop headings in the rail, where there is no
   *   width for them and the dividers carry the grouping on their own.
   */
  const itemsFor = (collapsed = false) => {
    const role = user.value?.role
    if (!role) return []

    return GROUPS.map((group) => {
      const visible = group.items
        .filter((item) => item.roles.includes(role))
        .map(({ roles, ...item }) => item)

      if (!visible.length) return []
      return group.label && !collapsed
        ? [{ label: group.label, type: 'label' }, ...visible]
        : visible
    }).filter((group) => group.length > 0)
  }

  return { itemsFor }
}
