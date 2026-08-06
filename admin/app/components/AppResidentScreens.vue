<script setup>
// The resident record's Drug screens section. READ-ONLY.
//
// The record answers what this person's screens have found; recording, the
// decision and the lab result all live on /screens — the Apartment checks
// split, and for a sharper reason here: a screen needs a specimen, a witness
// and a cup read in a hallway, and a form on a record page is an invitation to
// reconstruct one from memory.
//
// NO hero and NO rail dot, deliberately. A dot on a Clinical section is an
// ambient clinical signal on every screen that renders the rail, which is
// exactly what module 13 warns about — and it is why `sectionDots()` gains
// nothing and `GET /residents/:id` carries no screens block at all.
//
// Outcomes are hidden per row here too, on the same 30-second reveal.
import { humanEnum, confirmationDisplay, toneClass, SCREEN_REASONS } from '~/utils/screens.js'
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
const reasonLabel = (v) => SCREEN_REASONS.find((r) => r.value === v)?.label ?? humanEnum(v)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <p v-else-if="!hasActiveStay" class="text-muted-foreground text-sm">
      No active stay, so no screens are being collected. Their screening history belongs to the
      stay it was recorded on.
    </p>

    <p v-else-if="!screens.length" class="text-muted-foreground text-sm">
      No screens recorded on this stay yet.
    </p>

    <div v-else class="flex flex-col">
      <div
        v-for="s in screens"
        :key="s.id"
        class="flex flex-col gap-1 border-b px-1 py-2.5 last:border-b-0"
      >
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-[13px] font-medium tabular-nums">
            {{ humanDate(facilityDateOf(s.collectedAt), { short: true }) }}
            {{ formatFacilityTime(s.collectedAt) }}
          </span>
          <span class="text-muted-foreground text-[13px]">
            {{ reasonLabel(s.reason) }} · {{ humanEnum(s.method) }}
          </span>
          <Badge
            v-if="confirmationDisplay(s.confirmation).label"
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
          <span class="ms-auto"><AppScreenResult :screen-id="s.id" /></span>
        </div>
        <p class="text-muted-foreground/80 text-xs">
          Witness {{ s.witnessedBy.fullName }}<template v-if="s.specimenId"> · {{ s.specimenId }}</template>
          <template v-if="s.labName"> · {{ s.labName }}</template>
        </p>
      </div>
    </div>

    <p class="text-muted-foreground text-xs">
      Screens are recorded, confirmed and corrected on the
      <NuxtLink to="/screens" class="underline underline-offset-2">screens queue</NuxtLink>.
    </p>
  </div>
</template>
