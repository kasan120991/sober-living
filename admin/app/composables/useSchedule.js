/**
 * Schedule and events.
 *
 * Times cross the wire as wall-clock strings ('HH:MM') and dates as
 * 'YYYY-MM-DD', and the SERVER interprets them in the facility timezone — the
 * same contract as sign-outs. Responses carry UTC instants; display goes
 * through utils/facilityTime.js.
 *
 * Note what a session is addressed by: **(eventId, date)**, never a session id.
 * A future session has no row until something is recorded against it, so there
 * is no id to send — and a both-cohorts event has one roll spanning two
 * occurrences, so the event is the only address that covers it.
 */
export function useSchedule() {
  const api = useApi()

  /**
   * Returns { from, to, days, shared, lanes, needsRoll }.
   *
   * `lanes` is always two entries, MEN then WOMEN, even when one is empty, and
   * `shared` holds the events BOTH cohorts attend — which appear in the band
   * and in neither lane, so nothing renders twice.
   *
   * There is deliberately no flat list of sessions ON THE WIRE, so a client
   * cannot combine the cohorts without concatenating two arrays on purpose.
   * The calendar view does exactly that, and it is safe because the server has
   * already certified the two arrays disjoint. What must never exist is a
   * SERVER endpoint returning the flat list — that is the one a resident-facing
   * read would reach for.
   *
   * `needsRoll` looks BACKWARDS two weeks, independently of the window shown.
   */
  const getSchedule = (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== ''),
    ).toString()
    return api(`/schedule${q ? `?${q}` : ''}`)
  }

  /**
   * The people on one session, with their marks if the roll has been taken.
   * For a both-cohorts event this is ONE list spanning both.
   */
  const getRoll = (eventId, date) =>
    api(`/schedule/roll?eventId=${encodeURIComponent(eventId)}&date=${date}`)

  /** Every mark for one session in one request — twelve round trips is paper. */
  const takeAttendance = (body) => api('/schedule/attendance', { method: 'POST', body })

  /**
   * Active residents of the given cohorts, carrying `stayId` — rosters hang off
   * the stay. Pass both to get the one combined list a shared event picks from.
   */
  const listCandidates = (cohorts) =>
    api(`/schedule/candidates?cohort=${[].concat(cohorts).join(',')}`).then((r) => r.residents)

  /**
   * Move ONE date's session to a different wall-clock time. `startsAtLocal:
   * null` puts it back on the series rule. Managers only — a reschedule is a
   * decision, not an observation.
   */
  const rescheduleSession = (body) => api('/schedule/reschedule', { method: 'POST', body })

  const createEvent = (body) => api('/schedule/events', { method: 'POST', body })
  const getEvent = (id) => api(`/schedule/events/${id}`)

  /**
   * Change an event. Which fields the server will accept depends on what has been
   * recorded against it — `getEvent().recorded.frozen` says. Identity and the
   * roster are always live; when it runs freezes the moment anything is on the
   * record, because rewriting a recurrence rule takes already-taken sessions off
   * every screen while their rows stay in the database.
   */
  const updateEvent = (id, body) => api(`/schedule/events/${id}`, { method: 'PATCH', body })

  /**
   * Move a series: end this one the day before `from`, start its successor there.
   * The operation for "the Tuesday group is Thursdays now" — and the reason
   * editing a recurrence in place is refused once anything is recorded.
   */
  const moveSeries = (id, body) => api(`/schedule/events/${id}/move`, { method: 'POST', body })

  const deleteEvent = (id) => api(`/schedule/events/${id}`, { method: 'DELETE' })

  /** One resident's own schedule — their attendee rows, never their cohort. */
  const getResidentSchedule = (residentId) => api(`/residents/${residentId}/schedule`)

  return {
    getSchedule,
    getRoll,
    takeAttendance,
    listCandidates,
    rescheduleSession,
    createEvent,
    getEvent,
    updateEvent,
    moveSeries,
    deleteEvent,
    getResidentSchedule,
  }
}
