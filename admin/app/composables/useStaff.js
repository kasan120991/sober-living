/**
 * Colleagues — staff names and roles, never residents.
 *
 * Extracted from `useScreens` on 2026-08-07, when maintenance became the second
 * consumer CLAUDE.md said would come. A repair dialog importing a *drug screens*
 * composable to fill an assignee picker would be the wrong dependency entirely,
 * and the next module to need a staff picker would copy it.
 *
 * `GET /staff` is staff-only and excludes RESIDENT by construction, so a
 * resident's linked account can never appear in a picker.
 */
export function useStaff() {
  const api = useApi()

  /** Active staff: `{ id, fullName, role }`. */
  const listStaff = () => api('/staff').then((r) => r.staff)

  return { listStaff }
}
