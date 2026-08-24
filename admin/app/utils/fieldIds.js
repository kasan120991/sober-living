import { useId } from 'vue'

/**
 * Stable ids for one form's fields.
 *
 * `FieldLabel` renders a plain `Label`, so `for` and `id` are the caller's job
 * — unlike the `AppField` it replaced, which generated one internally and
 * handed it back through a slot prop. This is that convenience, minus the
 * wrapper component.
 *
 * Generated rather than hardcoded because more than one copy of a form can be
 * mounted at once — `AppSignOutDialog` is rendered by both the Sign-Outs page
 * and the dashboard's quick actions — and duplicate ids would point every
 * label at whichever control mounted first.
 *
 * Call it once in `<script setup>`:
 *
 *   const ids = useFieldIds('resident', 'destination', 'outTime')
 *   // <FieldLabel :for="ids.resident">Resident</FieldLabel>
 *   // <Input :id="ids.resident" … />
 *
 * @param {...string} names
 * @returns {Record<string, string>}
 */
export function useFieldIds(...names) {
  return Object.fromEntries(names.map((name) => [name, useId()]))
}
