<script setup>
// One apartment's check, as a FULL-SCREEN STEP of the round.
//
// The hallway shell for AppCheckForm. A side drawer is right on a desktop,
// where the apartment cards behind it are the picker and stay useful; on a
// 390px phone it spends a third of the viewport on the screen you just left,
// and the thing you are actually doing gets what is left over.
//
// The round has no forced sequence (decided 2026-08-06): saving returns to
// the picker, and the tech chooses what to walk next. The progress track and
// the "Apartment N of M" line are PROGRESS, not position in a queue.
import { Check } from '@lucide/vue'
import { checkState, formatFacilityTime, formatHourLabel } from '~/utils/facilityTime.js'
import { COHORT_LABEL } from '~/utils/schedule.js'

const route = useRoute()
const router = useRouter()
const { getChecks } = useChecks()

const data = ref(null)
const pending = ref(true)

async function load() {
  pending.value = !data.value
  data.value = await getChecks()
  pending.value = false
}
await load()

const apartmentId = computed(() => route.params.id)
const apartments = computed(() => data.value?.apartments ?? [])
const apartment = computed(() => apartments.value.find((a) => a.id === apartmentId.value) ?? null)

const stateOf = (a) => checkState(a.lastCheck?.at ?? null, Date.now())
const checkedCount = computed(() => apartments.value.filter((a) => stateOf(a) === 'CHECKED').length)
const position = computed(() => apartments.value.findIndex((a) => a.id === apartmentId.value) + 1)

/** Where this apartment sits in the round, for the header line. */
const positionLabel = computed(() =>
  position.value > 0 ? `Apartment ${position.value} of ${apartments.value.length}` : '',
)

const form = ref(null)

function onSaved() {
  // Back to the picker — the tech chooses the next apartment, not the app.
  router.push('/checks/round')
}
</script>

<template>
  <AppPage
    :title="apartment?.name ?? 'Check'"
    :back="{ label: 'Round', to: '/checks/round' }"
  >
    <template #description>
      <template v-if="apartment">
        {{ COHORT_LABEL[apartment.cohort] }} ·
        <span class="tabular-nums">{{ apartment.onSite }} of {{ apartment.occupants }}</span> on site
      </template>
    </template>
    <template #actions>
      <span v-if="positionLabel" class="text-muted-foreground text-xs tabular-nums">
        {{ positionLabel }}
      </span>
    </template>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>
    <p v-else-if="!apartment" class="text-muted-foreground text-sm">
      That apartment is not on this round.
    </p>

    <div v-else class="mx-auto flex w-full max-w-md flex-col gap-4">
      <!-- Progress across the round, not position in a queue. -->
      <div class="flex gap-1" aria-hidden="true">
        <i
          v-for="a in apartments"
          :key="a.id"
          class="h-1 flex-1 rounded-full"
          :class="[
            stateOf(a) === 'CHECKED' ? 'bg-primary' : 'bg-muted',
            a.id === apartmentId && stateOf(a) !== 'CHECKED' && 'bg-primary/40',
          ]"
        />
      </div>

      <!-- The form, edge to edge: this screen IS the check. -->
      <div class="bg-background -mx-3 flex flex-col rounded-lg">
        <AppCheckForm ref="form" :apartment="{ id: apartment.id, name: apartment.name }" @saved="onSaved" />
      </div>

      <div v-if="form?.ready" class="flex flex-col gap-2">
        <Button
          class="min-h-12 w-full"
          :disabled="form.pending || !form.canSave"
          @click="form.submit()"
        >
          <Check class="size-4" />
          Save check ·
          <span class="tabular-nums">{{ form.accountedCount }} of {{ form.people.length }}</span>
          accounted
        </Button>
        <p class="text-muted-foreground text-center text-xs tabular-nums">
          {{ data.hour ? `${formatHourLabel(data.hour.key)} round` : 'Round' }} ·
          {{ checkedCount }} of {{ apartments.length }} done
          <template v-if="apartment.lastCheck">
            · last checked {{ formatFacilityTime(apartment.lastCheck.at) }}
          </template>
        </p>
      </div>
    </div>
  </AppPage>
</template>
