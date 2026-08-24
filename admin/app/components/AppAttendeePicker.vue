<script setup>
// Picking who is on an event.
//
// A ROW IS A REAL CHECKBOX. It used to be a <button aria-pressed>, because the
// note here said "a checkbox we do not have" — nothing multi-select was in
// components/ui/, and adding one rewrote main.css with the Google Fonts CDN
// imports CLAUDE.md forbids. `npm run ui:add` handles that now, so the row is
// the vendored Checkbox wrapped in a <label>: a multi-select list is checkboxes,
// and aria-pressed is a toggle BUTTON, which a screen reader announces as
// "pressed" rather than "checked" and never counts as "3 of 12 selected".
//
// The <label> is what keeps the whole row tappable — the hallway rule — while
// the control itself stays 16px. Checkbox already carries an ::after hit-area
// inset, the same trick the vendored Switch uses.
//
// Rows carry program and bed because two residents sharing a first name has to
// be resolvable without opening anything.
import { COHORT_LABEL } from '~/utils/schedule.js'

const props = defineProps({
  /** `[{ stayId, fullName, cohort, programName, bedLabel }]`, one cohort or both. */
  candidates: { type: Array, default: () => [] },
  /** Selected `stayId`s. */
  modelValue: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  /**
   * Whether to badge each row with its cohort. Set by the PARENT from the
   * event's cohorts, deliberately not derived from the data: a both-cohorts
   * event in a house where every active resident happens to be a man would
   * silently lose the badge, and telling you the list spans both is its job.
   */
  showCohort: { type: Boolean, default: false },
  /** A filter field above the list. Worth it once a house has thirty residents. */
  searchable: { type: Boolean, default: false },
  /** Height cap for the scroller — a dialog column affords more than a page. */
  listClass: { type: String, default: 'max-h-72' },
})
const emit = defineEmits(['update:modelValue'])

const selected = computed(() => new Set(props.modelValue))

const query = ref('')

/**
 * Searching NARROWS WHAT IS SHOWN, never what is selected.
 *
 * Somebody filtered to "mar", ticked Marisol, then cleared the box — Marisol
 * stays on. A filter that silently dropped hidden selections would make the
 * roster depend on what happened to be typed when Create was pressed.
 */
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.candidates
  return props.candidates.filter((c) => c.fullName.toLowerCase().includes(q))
})

const isFiltered = computed(() => shown.value.length !== props.candidates.length)

// Select-all acts on WHAT IS SHOWN, which is the only reading that stays useful
// while filtered — and the label says so, because "Select all" over a filtered
// list is otherwise a promise about rows the user cannot see.
const allShownSelected = computed(
  () => shown.value.length > 0 && shown.value.every((c) => selected.value.has(c.stayId)),
)

function toggle(stayId) {
  const next = new Set(props.modelValue)
  next.has(stayId) ? next.delete(stayId) : next.add(stayId)
  emit('update:modelValue', [...next])
}

function toggleAll() {
  const next = new Set(props.modelValue)
  if (allShownSelected.value) for (const c of shown.value) next.delete(c.stayId)
  else for (const c of shown.value) next.add(c.stayId)
  emit('update:modelValue', [...next])
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <Input
      v-if="searchable && candidates.length"
      v-model="query"
      type="search"
      placeholder="Search this list…"
      aria-label="Search residents"
    />

    <div class="flex items-center gap-3">
      <!-- Counted against the FULL candidate list, not the filtered one: the
           roster's size is a fact about the event, and it must not appear to
           shrink because somebody typed in the search box. -->
      <span class="text-muted-foreground text-xs tabular-nums">
        {{ modelValue.length }} of {{ candidates.length }} selected
      </span>
      <Button
        v-if="shown.length"
        type="button"
        size="sm"
        variant="ghost"
        class="ms-auto"
        @click="toggleAll"
      >
        {{ allShownSelected ? 'Clear' : 'Select' }}
        {{ isFiltered ? `these ${shown.length}` : 'all' }}
      </Button>
    </div>

    <p v-if="loading" class="text-muted-foreground text-sm">Loading residents…</p>

    <div v-else-if="shown.length" class="overflow-y-auto rounded-md border" :class="listClass">
      <label
        v-for="c in shown"
        :key="c.stayId"
        class="hover:bg-accent/50 has-focus-visible:ring-ring/30 flex min-h-12 w-full cursor-pointer items-center gap-3 border-b px-3 py-2 text-left transition-colors last:border-b-0 has-focus-visible:ring-3 max-md:min-h-14 pointer-coarse:min-h-14"
        :class="selected.has(c.stayId) && 'bg-accent/40'"
      >
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13.5px]">{{ c.fullName }}</span>
          <span class="text-muted-foreground block truncate text-[11px]">
            <!-- A word, not a hue: colour stays reserved for session state. -->
            <template v-if="showCohort">{{ COHORT_LABEL[c.cohort] }} · </template>
            {{ c.programName ?? 'No program' }}
            <template v-if="c.bedLabel"> · {{ c.bedLabel }}</template>
            <template v-else> · Awaiting a bed</template>
          </span>
        </span>
        <!-- The label already toggles on click, so this takes no @click of its
             own — one would fire a second time and cancel the first. -->
        <Checkbox
          :model-value="selected.has(c.stayId)"
          class="shrink-0"
          @update:model-value="toggle(c.stayId)"
        />
      </label>
    </div>

    <!-- Two different empty states, because they mean different things: nobody
         matched what you typed, versus nobody is here to pick. Collapsing them
         would have a search miss read as an empty house. -->
    <p v-else-if="candidates.length" class="text-muted-foreground text-sm">
      Nobody on this list matches “{{ query.trim() }}”.
    </p>
    <p v-else class="text-muted-foreground text-sm">
      No active residents in {{ showCohort ? 'either cohort' : 'this cohort' }}.
    </p>
  </div>
</template>
