<script setup>
// Creating an event — the form itself, in one place.
//
// Rendered by TWO shells: AppEventCreateDialog (wide, two columns, md and up)
// and pages/schedule/new.vue (stacked, the phone). Every ref, computed and
// validation rule lives here precisely so those two cannot drift — the same
// reasoning that collapsed three state→appearance mappings into
// sessionStateDisplay(). A second copy of `chooseCohorts` is how the dialog
// comes to confirm a narrowing that the page performs silently.
//
// ONE event, ONE time, ONE roster — whoever attends. Pick the men, the women or
// both; every field is entered once. A both-cohorts event is still stored as an
// occurrence per cohort, because that is what lets the composite foreign keys
// refuse a woman on a men's occurrence — but that split is a storage detail and
// nothing here knows about it. The server does the fan-out and routes each
// resident to their own cohort, so this form cannot get it wrong.
//
// ── Layout, and why cohort sits where it does ──────────────────────────────
// In BOTH layouts the cohort switch immediately precedes the roster, because it
// is the only control on this form whose effect is another control's contents.
// Chosen 2026-08-05 from three rendered variants; the two rejected ones both
// left it with the event fields, where switching Men → Both refills a list on
// the far side of the dialog with nothing connecting cause to effect.
//
// The cost of that, accepted knowingly: "who attends" stops reading as an event
// fact alongside title and location. The summary sentence answers it — it names
// the cohort in words, and it sits under the timing fields in both layouts.
import { COHORT_LABEL, RECURRENCE, WEEKDAYS, cohortsLabel, recurrenceLabel } from '~/utils/schedule.js'
import { facilityDateNow, formatWallClock, humanDate, weekdayOf } from '~/utils/facilityTime.js'

const props = defineProps({
  /**
   * `'columns'` for the dialog, `'stacked'` for the page. Purely presentational —
   * the field set, the order of the sections and every rule are identical.
   */
  layout: { type: String, default: 'stacked' },
  /**
   * `{ date, time, minutes }`, already validated by the caller. Arrives from the
   * calendar's click-empty-space, as a prop from the dialog or a query string on
   * the page.
   */
  prefill: { type: Object, default: () => ({}) },
  /**
   * An existing event from `getEvent`, or null to create one. When set, this is an
   * EDIT — the dual-mode shape AppServiceEntryDialog established.
   *
   * It carries `recorded`, which decides which fields are offered at all: once
   * anything has been recorded the shape fields are locked, because rewriting a
   * recurrence rule takes already-taken sessions off every read path.
   */
  event: { type: Object, default: null },
})
const emit = defineEmits(['created', 'saved', 'cancel', 'move'])

const { createEvent, updateEvent, listCandidates } = useSchedule()
const notify = useNotify()

const today = facilityDateNow()
const isColumns = computed(() => props.layout === 'columns')
const isEdit = computed(() => Boolean(props.event))

/**
 * Shape is locked once anything is on the record. The server enforces this
 * independently — this is presentation, so somebody is not invited to fill in a
 * form that will be refused.
 */
const shapeLocked = computed(() => Boolean(props.event?.recorded?.frozen))

/** What is on the record, in words, for the lock explanation. */
const recordedLabel = computed(() => {
  const r = props.event?.recorded
  if (!r?.frozen) return ''
  const bits = []
  if (r.marked) bits.push(`${r.marked} attendance ${r.marked === 1 ? 'mark' : 'marks'}`)
  if (r.cancelled) bits.push(`${r.cancelled} cancelled ${r.cancelled === 1 ? 'session' : 'sessions'}`)
  return bits.join(' and ')
})

// A ONCE default when a specific slot was picked: somebody who dragged out a
// slot on a given day meant that day, and a weekly default would quietly
// schedule fifty-two of them.
const picked = {
  date: /^\d{4}-\d{2}-\d{2}$/.test(props.prefill.date ?? '') ? props.prefill.date : null,
  time: /^([01]\d|2[0-3]):[0-5]\d$/.test(props.prefill.time ?? '') ? props.prefill.time : null,
  minutes: Number(props.prefill.minutes) || null,
}

const form = reactive({
  title: '',
  description: '',
  location: '',
  startsAtLocal: picked.time ?? '18:00',
  durationMinutes: picked.minutes ?? 60,
  recurrence: picked.date ? RECURRENCE.ONCE : RECURRENCE.WEEKLY,
  weekdays: [weekdayOf(picked.date ?? today)],
  startsOn: picked.date ?? today,
  endsOn: '',
})

/** Men, Women, or Both. "Everyone" is two cohorts asked for, never a null one. */
const CHOICES = [
  { key: 'MEN', cohorts: ['MEN'] },
  { key: 'WOMEN', cohorts: ['WOMEN'] },
  { key: 'BOTH', cohorts: ['MEN', 'WOMEN'] },
]
const choice = ref('MEN')
const cohorts = computed(() => CHOICES.find((c) => c.key === choice.value).cohorts)

const candidates = ref([])
const stayIds = ref([])
const loadingCandidates = ref(false)
const pending = ref(false)
const error = ref('')

async function loadCandidates() {
  loadingCandidates.value = true
  try {
    candidates.value = await listCandidates(cohorts.value)
  } catch {
    error.value = 'Could not load residents for that cohort.'
  } finally {
    loadingCandidates.value = false
  }
}
/**
 * Hydrate from the event being edited.
 *
 * Re-assigned wholesale on every change of `props.event`, the way
 * AppApartmentEdit re-fills on every open, so the form can never show one
 * event's title over another's roster. Runs before candidates load, so `stayIds`
 * is already set when the picker appears.
 */
function hydrate() {
  const e = props.event
  if (!e) return
  Object.assign(form, {
    title: e.title ?? '',
    description: e.description ?? '',
    location: e.location ?? '',
    startsAtLocal: e.startsAtLocal,
    durationMinutes: e.durationMinutes,
    recurrence: e.recurrence,
    weekdays: [...(e.weekdays ?? [])],
    startsOn: e.startsOn,
    endsOn: e.endsOn ?? '',
  })
  choice.value = CHOICES.find((c) => c.cohorts.join(',') === (e.cohorts ?? []).join(','))?.key ?? 'MEN'
  stayIds.value = (e.attendees ?? []).map((a) => a.stayId)
}
watch(() => props.event?.id, hydrate, { immediate: true })

// onMounted rather than a top-level await: inside a dialog, a top-level await
// suspends the whole content subtree and the panel opens empty.
onMounted(loadCandidates)

/**
 * Narrowing the cohort selection FILTERS the roster rather than clearing it.
 *
 * Widening (Men → Both) can never drop anyone, so it needs no confirmation.
 * Narrowing drops the other cohort, and that is worth confirming — with a
 * COUNT, never names: this is a form, and a name in a confirm dialog is read by
 * whoever is standing behind the screen.
 */
async function chooseCohorts(key) {
  if (choice.value === key) return
  const next = CHOICES.find((c) => c.key === key).cohorts
  const keep = candidates.value.filter(
    (c) => stayIds.value.includes(c.stayId) && next.includes(c.cohort),
  )
  const dropped = stayIds.value.length - keep.length

  if (dropped > 0) {
    const ok = window.confirm(
      `Switching to ${cohortsLabel(next)} removes ${dropped} resident${dropped === 1 ? '' : 's'} from the roster. Continue?`,
    )
    if (!ok) return
  }

  choice.value = key
  stayIds.value = keep.map((c) => c.stayId)
  await loadCandidates()
}

function toggleWeekday(value) {
  const i = form.weekdays.indexOf(value)
  i === -1 ? form.weekdays.push(value) : form.weekdays.splice(i, 1)
}

const valid = computed(
  () =>
    form.title.trim().length > 0 &&
    form.startsOn &&
    form.durationMinutes > 0 &&
    (form.recurrence === RECURRENCE.ONCE || form.weekdays.length > 0),
)

/** Everything the create endpoint wants, from the current form state. */
function fullPayload() {
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    location: form.location.trim() || undefined,
    cohorts: cohorts.value,
    startsAtLocal: form.startsAtLocal,
    durationMinutes: Number(form.durationMinutes),
    recurrence: form.recurrence,
    // A one-off carries no weekdays and the server derives its endsOn.
    weekdays: form.recurrence === RECURRENCE.ONCE ? [] : form.weekdays,
    startsOn: form.startsOn,
    endsOn: form.recurrence === RECURRENCE.ONCE ? undefined : form.endsOn || undefined,
    stayIds: stayIds.value,
  }
}

/**
 * A PATCH sends only what changed — and on a frozen event it must not mention a
 * shape field AT ALL, even one whose value is unchanged.
 *
 * `updateEvent` decides what changed from what is PRESENT in the body, so sending
 * `startsAtLocal: '19:00'` on a frozen event whose time is already 19:00 is fine,
 * but sending a locked field the user could not have edited is how a save starts
 * failing for a reason nobody typed. Omitting unchanged fields keeps the request
 * describing an intention rather than restating the record.
 */
function patchPayload() {
  const e = props.event
  const out = {}
  const put = (k, v, was) => {
    if (v !== was) out[k] = v
  }

  put('title', form.title.trim(), e.title)
  put('description', form.description.trim() || null, e.description ?? null)
  put('location', form.location.trim() || null, e.location ?? null)

  if (!shapeLocked.value) {
    put('startsAtLocal', form.startsAtLocal, e.startsAtLocal)
    put('durationMinutes', Number(form.durationMinutes), e.durationMinutes)
    put('recurrence', form.recurrence, e.recurrence)
    put('startsOn', form.startsOn, e.startsOn)

    const nextDays = form.recurrence === RECURRENCE.ONCE ? [] : form.weekdays
    if (nextDays.join(',') !== (e.weekdays ?? []).join(',')) out.weekdays = nextDays

    const nextCohorts = cohorts.value
    if (nextCohorts.join(',') !== (e.cohorts ?? []).join(',')) out.cohorts = nextCohorts
  }

  // endsOn is editable even while frozen — the server holds it above the last
  // recorded date rather than refusing it outright.
  if (form.recurrence !== RECURRENCE.ONCE) {
    put('endsOn', form.endsOn || null, e.endsOn ?? null)
  }

  const nextRoster = [...stayIds.value].sort().join(',')
  if (nextRoster !== (e.attendees ?? []).map((a) => a.stayId).sort().join(',')) {
    out.stayIds = stayIds.value
  }
  return out
}

async function submit() {
  if (!valid.value || pending.value) return
  pending.value = true
  error.value = ''
  try {
    if (isEdit.value) {
      const body = patchPayload()
      if (!Object.keys(body).length) {
        // The server refuses an empty patch, and rightly — but "nothing changed"
        // is not an error the user made.
        notify.info('Nothing changed')
        emit('saved', props.event)
        return
      }
      const saved = await updateEvent(props.event.id, body)
      notify.success(`${saved.title} updated`)
      emit('saved', saved)
      return
    }

    const created = await createEvent(fullPayload())
    notify.success(`${created.title} scheduled`)
    emit('created', created)
  } catch (err) {
    error.value =
      err?.data?.error ?? `Could not ${isEdit.value ? 'save the changes' : 'create the event'}.`
  } finally {
    pending.value = false
  }
}

defineExpose({ submit, valid, pending })

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('description', 'field', 'lastDate', 'location', 'minutes', 'onTheseDays', 'repeats', 'startsAt', 'title')
</script>

<template>
  <form :id="'event-form'" class="flex min-w-0 flex-col gap-5" @submit.prevent="submit">
    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div
      class="grid min-w-0 gap-6"
      :class="isColumns && 'md:grid-cols-[minmax(0,1fr)_380px] md:gap-8'"
    >
      <!-- ── Left: the event, and when ───────────────────────────────────── -->
      <div class="flex min-w-0 flex-col gap-5">
        <section class="flex flex-col gap-4">
          <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
            The event
          </h2>
          <Field>
            <FieldLabel :for="ids.title">Title<span class="text-destructive" aria-hidden="true">*</span></FieldLabel>
            <Input :id="ids.title" v-model="form.title" placeholder="House Meeting" required />
          </Field>
          <div class="flex flex-col gap-4 sm:flex-row">
            <Field class="flex-1">
              <FieldLabel :for="ids.location">Location</FieldLabel>
              <Input :id="ids.location" v-model="form.location" placeholder="Common room" />
            </Field>
            <Field class="flex-1">
              <FieldLabel :for="ids.description">Description</FieldLabel>
              <Input :id="ids.description" v-model="form.description" placeholder="Optional" />
            </Field>
          </div>
        </section>

        <section class="flex flex-col gap-4">
          <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
            When
          </h2>

          <!-- Locked, with the reason, rather than hidden. Somebody who came here
               to change the day needs to know why they cannot and what to do
               instead — the AppApartmentEdit "Locked while this apartment has
               beds" pattern. The Move button is the answer. -->
          <Alert v-if="shapeLocked">
            <AlertDescription class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span>
                This event has {{ recordedLabel }} against it, so when it runs is part of the
                record. Changing it here would take those sessions off every screen.
              </span>
              <Button type="button" size="xs" variant="outline" @click="emit('move')">
                Move the series…
              </Button>
            </AlertDescription>
          </Alert>

          <div class="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel :for="ids.startsAt">Starts at</FieldLabel>
              <Input
                :id="ids.startsAt"
                v-model="form.startsAtLocal"
                type="time"
                required
                :disabled="shapeLocked"
              />
            </Field>
            <Field>
              <FieldLabel :for="ids.minutes">Minutes</FieldLabel>
              <Input
                :id="ids.minutes"
                v-model.number="form.durationMinutes"
                type="number"
                min="1"
                max="1440"
                required
                :disabled="shapeLocked"
              />
            </Field>
            <Field>
              <FieldLabel :for="ids.repeats">Repeats</FieldLabel>
              <Select v-model="form.recurrence" :disabled="shapeLocked">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem :value="RECURRENCE.WEEKLY">Weekly</SelectItem>
                  <SelectItem :value="RECURRENCE.ONCE">Once</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field v-if="form.recurrence === RECURRENCE.WEEKLY">
            <FieldLabel :for="ids.onTheseDays">On these days</FieldLabel>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="d in WEEKDAYS"
                :key="d.value"
                type="button"
                :disabled="shapeLocked"
                class="min-h-9 rounded-md border px-2.5 text-xs transition-colors max-md:min-h-11 pointer-coarse:min-h-11 disabled:opacity-50"
                :class="
                  form.weekdays.includes(d.value)
                    ? 'bg-accent border-foreground/30 font-semibold'
                    : 'text-muted-foreground enabled:hover:bg-accent/50'
                "
                :aria-pressed="form.weekdays.includes(d.value)"
                :aria-label="d.full"
                @click="toggleWeekday(d.value)"
              >
                {{ d.label }}
              </button>
            </div>
            <FieldDescription>{{
              shapeLocked
                ? 'Fixed — this series has a record against it.'
                : 'Mon/Wed/Fri is one event on three days, not three events.'
             }}</FieldDescription>
          </Field>

          <div class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel :for="ids.field">{{ form.recurrence === RECURRENCE.ONCE ? 'Date' : 'First date' }}</FieldLabel>
              <Input
                :id="ids.field"
                v-model="form.startsOn"
                type="date"
                required
                :disabled="shapeLocked"
              />
            </Field>
            <Field v-if="form.recurrence === RECURRENCE.WEEKLY">
              <FieldLabel :for="ids.lastDate">Last date</FieldLabel>
              <Input :id="ids.lastDate" v-model="form.endsOn" type="date" />
              <FieldDescription>Leave blank to run until it is ended.</FieldDescription>
            </Field>
          </div>

          <!-- This sentence is what pays for moving the cohort switch away from
               the event fields: it states the cohort in words, next to the
               timing, so "who attends" is still readable as a fact about the
               event without hunting for the control that set it. -->
          <p class="text-muted-foreground border-t pt-3 text-xs">
            {{ recurrenceLabel(form) }} at
            <span class="text-foreground font-medium tabular-nums">
              {{ formatWallClock(form.startsAtLocal) }}
            </span>
            for
            <span class="text-foreground font-medium tabular-nums">{{ form.durationMinutes }}</span>
            minutes, from
            {{ humanDate(form.startsOn, { short: true, relative: false }) }}
            <template v-if="form.endsOn && form.recurrence === RECURRENCE.WEEKLY">
              to {{ humanDate(form.endsOn, { short: true, relative: false }) }}
            </template>
            ·
            <span class="text-foreground font-medium">{{ cohortsLabel(cohorts) }}</span>
            · facility time.
          </p>
        </section>
      </div>

      <!-- ── Right: who attends ──────────────────────────────────────────────
           The cohort switch heads this column, directly above the list it
           governs. In the stacked layout it is the same order, just below
           rather than beside. -->
      <div class="flex min-w-0 flex-col gap-3" :class="isColumns && 'md:border-l md:pl-8'">
        <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Who attends
        </h2>

        <!-- Cohort is a shape field: adding one creates an occurrence, removing one
             takes its sessions with it. Locked with the rest of them. -->
        <Tabs :model-value="choice" @update:model-value="chooseCohorts">
          <TabsList class="w-full">
            <TabsTrigger
              v-for="c in CHOICES"
              :key="c.key"
              :value="c.key"
              :disabled="shapeLocked"
              class="flex-1"
            >
              {{ cohortsLabel(c.cohorts) }}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <AppAttendeePicker
          v-model="stayIds"
          searchable
          :candidates="candidates"
          :loading="loadingCandidates"
          :show-cohort="cohorts.length === 2"
          :list-class="isColumns ? 'max-h-[26rem]' : 'max-h-72'"
        />

        <p class="text-muted-foreground text-xs">
          Attendance is explicit. A resident is on this because they are on the roster, never
          because of their cohort.
          <template v-if="cohorts.length === 1">
            Switching to
            {{ cohorts[0] === 'MEN' ? COHORT_LABEL.WOMEN : COHORT_LABEL.MEN }} or Both changes
            this list.
          </template>
        </p>
      </div>
    </div>

    <!-- The page supplies its own footer; the dialog puts these in DialogFooter,
         so both are rendered by the shell rather than here. -->
    <slot name="footer" :valid="valid" :pending="pending" :count="stayIds.length" />
  </form>
</template>
