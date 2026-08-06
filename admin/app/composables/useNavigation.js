import {
  Building2,
  CalendarDays,
  ClipboardCheck,
  DoorOpen,
  FlaskConical,
  HandHeart,
  Home,
  IdCard,
  LayoutDashboard,
  Pill,
  Plane,
  ScrollText,
  Users,
  Wrench,
} from '@lucide/vue'
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
 *
 * Icons are Lucide components rather than `i-lucide-*` strings — shadcn-vue
 * imports icons directly instead of resolving them from a name.
 */

const ALL_STAFF = [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER, STAFF_ROLE.STAFF]
const MANAGERS = [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER]
const ADMIN_ONLY = [STAFF_ROLE.ADMIN]

const GROUPS = [
  {
    id: 'main',
    items: [
      // The dashboard is the landing page (2026-08-05); the census board —
      // home before that — lives at /census, still named by its domain term.
      { label: 'Dashboard', icon: LayoutDashboard, to: '/', roles: ALL_STAFF },
      { label: 'Census', icon: Home, to: '/census', roles: ALL_STAFF },
      { label: 'Residents', icon: Users, to: '/residents', roles: ALL_STAFF },
    ],
  },
  {
    id: 'daily',
    label: 'Daily',
    items: [
      { label: 'Apartment Checks', icon: ClipboardCheck, to: '/checks', roles: ALL_STAFF },
      { label: 'Drug Screens', icon: FlaskConical, to: '/screens', roles: ALL_STAFF },
      { label: 'Med Pass', icon: Pill, to: '/meds', roles: ALL_STAFF },
      { label: 'Sign-Outs', icon: DoorOpen, to: '/sign-outs', roles: ALL_STAFF },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    items: [
      { label: 'Schedule', icon: CalendarDays, to: '/schedule', roles: ALL_STAFF },
      { label: 'Travel Passes', icon: Plane, to: '/passes', roles: ALL_STAFF },
      { label: 'Community Service', icon: HandHeart, to: '/service', roles: ALL_STAFF },
    ],
  },
  {
    id: 'facility',
    label: 'Facility',
    items: [
      { label: 'Apartments & Beds', icon: Building2, to: '/apartments', roles: MANAGERS },
      // Visible to every staff role: a tech who finds a broken latch during an
      // apartment check should be able to file it there and then. Consequence —
      // techs now see a Facility group containing only this.
      { label: 'Maintenance', icon: Wrench, to: '/maintenance', roles: ALL_STAFF },
    ],
  },
  {
    // sidebar-08's secondary group: pinned to the bottom, smaller, unlabelled.
    // Administration rather than operations — nobody opens these on shift, and
    // sitting them under "Facility" implied they were part of running the house.
    id: 'admin',
    secondary: true,
    items: [
      { label: 'Staff', icon: IdCard, to: '/staff', roles: ADMIN_ONLY },
      { label: 'Audit Log', icon: ScrollText, to: '/audit', roles: ADMIN_ONLY },
    ],
  },
]

export function useNavigation() {
  const { user } = useAuth()

  /**
   * Groups the current role may see, each with its visible items. Empty groups
   * are dropped so a role never gets a heading with nothing under it.
   */
  const itemsFor = () => {
    const role = user.value?.role
    if (!role) return []

    return GROUPS.map((group) => ({
      id: group.id,
      label: group.label ?? null,
      secondary: group.secondary ?? false,
      items: group.items.filter((item) => item.roles.includes(role)),
    })).filter((group) => group.items.length > 0)
  }

  /** The operational nav, and the administrative group pinned below it. */
  const sections = computed(() => {
    const groups = itemsFor()
    return {
      main: groups.filter((g) => !g.secondary),
      secondary: groups.find((g) => g.secondary)?.items ?? [],
    }
  })

  return { itemsFor, sections }
}
