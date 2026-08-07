<script setup>
// The resident record's Drug screens section. READ-ONLY.
//
// The record answers how this person has screened; recording, the decision and
// the lab result all live on /screens — the Apartment checks split, and for a
// sharper reason here: a screen needs a specimen, a witness and a cup read in
// a hallway, and a form on a record page invites reconstructing one from
// memory.
//
// ── Counts band over a month-grouped history (chosen 2026-08-06 from three
// rendered variants; a standing hero and a card-per-screen were the others).
// The Schedule section's attendance idiom applied to screens, so the two
// history-shaped sections of this record read the same way.
//
// RESULTS ARE VISIBLE INLINE here, and deliberately unlike /screens. That page
// lists many people at once and keeps its fetch-on-reveal boundary; this one
// is a deliberate navigation to ONE named person somebody already chose —
// which is the argument module 1 makes for techs seeing the Clinical group at
// all. The audit unit becomes "opened this resident's screens", which is the
// right grain for a page about one person.
//
// NO rail dot, still: a dot on a Clinical section is an ambient clinical
// signal on every screen that draws the rail.
import { humanEnum, resultDisplay, confirmationDisplay, toneClass, SCREEN_REASONS } from '~/utils/screens.js'
import { facilityDateOf, formatFacilityTime, humanDate } from '~/utils/facilityTime.js'

const props = defineProps({
  residentId: { type: String, required: true },
})

const { getResidentScreens } = useScreens()

const data = ref(null)
const pending = ref(true)

async function load() {
  pending.value = !data.value
  data.value = await getResidentScreens(props.residentId)
  pending.value = false
}
await load()
onRealtimeChanged(load)

const hasActiveStay = computed(() => data.value?.hasActiveStay !== false)
const screens = computed(() => data.value?.screens ?? [])
const summary = computed(() => data.value?.summary ?? null)

/**
 * The band's segments. An OVERTURNED screen is muted, not red — the whole
 * module rests on the lab being authoritative, and colouring a cleared
 * resident's screen the same as a standing positive would contradict it on
 * the one surface a reviewer scans fastest.
 */
const segments = computed(() => {
  const s = summary.value
  if (!s) return []
  return [
    { key: 'negative', n: s.negative, class: 'bg-success' },
    { key: 'dilute', n: s.dilute, class: 'bg-warning' },
    { key: 'refusal', n: s.refusal, class: 'bg-warning' },
    { key: 'notRead', n: s.notRead, class: 'bg-muted-foreground/40' },
    { key: 'overturned', n: s.overturned, class: 'bg-muted-foreground/40' },
    { key: 'positive', n: s.positive, class: 'bg-destructive' },
  ].filter((seg) => seg.n > 0)
})

const MONTH = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })
/** Order-preserving month grouping over the newest-first list. */
const byMonth = computed(() => {
  const out = []
  for (const s of screens.value) {
    const key = MONTH.format(new Date(`${facilityDateOf(s.collectedAt)}T00:00:00.000Z`))
    if (out.at(-1)?.key !== key) out.push({ key, screens: [] })
    out.at(-1).screens.push(s)
  }
  return out
})

const reasonLabel = (v) => SCREEN_REASONS.find((r) => r.value === v)?.label ?? humanEnum(v)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-5">
    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <p v-else-if="!hasActiveStay" class="text-muted-foreground text-sm">
      No active stay, so no screens are being collected. Their screening history belongs to the
      stay it was recorded on.
    </p>

    <p v-else-if="!screens.length" class="text-muted-foreground text-sm">
      No screens recorded on this stay yet.
    </p>

    <template v-else>
      <!-- ── The band. Counts, never a percentage — a resident may have two
           screens, and "50%" would imply a measurement where "1 of 2" carries
           its own sample size. Hidden entirely when nothing is recorded. ── -->
      <section v-if="summary" class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          This stay
        </h2>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <span class="text-muted-foreground">
            <span class="text-foreground font-semibold tabular-nums">{{ summary.total }}</span>
            {{ summary.total === 1 ? 'screen' : 'screens' }}
          </span>
          <span v-if="summary.negative" class="text-muted-foreground">
            <span class="text-foreground font-semibold tabular-nums">{{ summary.negative }}</span> negative
          </span>
          <span v-if="summary.positive" class="text-muted-foreground">
            <span class="text-destructive font-semibold tabular-nums">{{ summary.positive }}</span> positive
          </span>
          <span v-if="summary.dilute" class="text-muted-foreground">
            <span class="text-foreground font-semibold tabular-nums">{{ summary.dilute }}</span> dilute
          </span>
          <span v-if="summary.refusal" class="text-muted-foreground">
            <span class="text-foreground font-semibold tabular-nums">{{ summary.refusal }}</span>
            {{ summary.refusal === 1 ? 'refusal' : 'refusals' }}
          </span>
          <span v-if="summary.notRead" class="text-muted-foreground">
            <span class="text-foreground font-semibold tabular-nums">{{ summary.notRead }}</span> not read
          </span>
          <span v-if="summary.overturned" class="text-muted-foreground">
            <span class="text-foreground font-semibold tabular-nums">{{ summary.overturned }}</span>
            {{ summary.overturned === 1 ? 'positive cup, overturned' : 'positive cups, overturned' }}
          </span>
        </div>

        <!-- The h-2 flex track from AppServiceProgress / AppCohortCapacity,
             deliberately not shadcn's Progress. -->
        <div class="bg-muted flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          <i v-for="seg in segments" :key="seg.key" class="block" :class="seg.class" :style="{ flex: seg.n }" />
        </div>
        <p v-if="data.since" class="text-muted-foreground text-xs">
          since intake · {{ humanDate(facilityDateOf(data.since), { short: true, relative: false }) }}
        </p>
      </section>

      <!-- ── History ────────────────────────────────────────────────────── -->
      <section class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          History
        </h2>

        <div class="flex flex-col gap-3">
          <div v-for="group in byMonth" :key="group.key">
            <p class="text-muted-foreground mb-1 text-xs font-medium">{{ group.key }}</p>
            <div class="flex flex-col">
              <div
                v-for="s in group.screens"
                :key="s.id"
                class="flex flex-col gap-1 border-b px-1 py-2.5 last:border-b-0"
              >
                <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span class="w-28 shrink-0 text-[13px] font-medium tabular-nums">
                    {{ humanDate(facilityDateOf(s.collectedAt), { short: true }) }}
                  </span>

                  <!-- A contradicted screen renders BOTH: the facility has to
                       be able to show it read a positive cup AND that the lab
                       overturned it. -->
                  <Badge
                    variant="outline"
                    class="border-transparent text-[10px]"
                    :class="[
                      toneClass(resultDisplay(s.outcome.result).tone),
                      s.outcome.contradicted && 'line-through opacity-70',
                    ]"
                  >
                    <template v-if="s.outcome.contradicted">Cup: </template>
                    {{ resultDisplay(s.outcome.result).label }}
                  </Badge>
                  <span v-if="s.outcome.substances.length" class="text-muted-foreground text-[11px]">
                    {{ s.outcome.substances.map(humanEnum).join(', ') }}
                  </span>

                  <template v-if="s.outcome.labResult">
                    <span class="text-muted-foreground text-[11px]">→</span>
                    <Badge
                      variant="outline"
                      class="border-transparent text-[10px]"
                      :class="toneClass(resultDisplay(s.outcome.labResult).tone)"
                    >
                      Lab: {{ resultDisplay(s.outcome.labResult).label }}
                    </Badge>
                    <span v-if="s.outcome.labSubstances.length" class="text-muted-foreground text-[11px]">
                      {{ s.outcome.labSubstances.map(humanEnum).join(', ') }}
                    </span>
                  </template>

                  <Badge
                    v-if="confirmationDisplay(s.confirmation).label && !s.outcome.labResult"
                    variant="outline"
                    class="border-transparent text-[10px]"
                    :class="toneClass(confirmationDisplay(s.confirmation).tone)"
                  >
                    {{ confirmationDisplay(s.confirmation).label }}
                  </Badge>
                  <Badge
                    v-if="s.amended"
                    variant="outline"
                    class="text-muted-foreground text-[10px]"
                    :title="s.amendmentReason ?? undefined"
                  >
                    Amended
                  </Badge>
                </div>

                <p class="text-muted-foreground/80 ps-1 text-xs">
                  {{ reasonLabel(s.reason) }} · {{ humanEnum(s.method) }} ·
                  {{ formatFacilityTime(s.collectedAt) }} · witness {{ s.witnessedBy.fullName }}
                  <template v-if="s.specimenId"> · {{ s.specimenId }}</template>
                  <template v-if="s.labName"> · {{ s.labName }}</template>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <p class="text-muted-foreground text-xs">
        Screens are recorded, confirmed and corrected on the
        <NuxtLink to="/screens" class="underline underline-offset-2">screens queue</NuxtLink>.
      </p>
    </template>
  </div>
</template>
