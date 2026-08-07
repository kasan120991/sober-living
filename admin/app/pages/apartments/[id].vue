<script setup>
import { ArrowLeft, Plus } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'
import { previewLabels } from '~/composables/useApartments.js'

const route = useRoute()
const { user } = useAuth()
const { getApartment, addBeds } = useApartments()
const notify = useNotify()

const refreshList = inject('refreshApartments', () => {})

const apartment = ref(null)
const pending = ref(true)

async function load() {
  // Blank the pane when arriving or switching apartments, never on a realtime
  // refresh of the one already shown.
  pending.value = apartment.value?.id !== route.params.id
  apartment.value = await getApartment(route.params.id)
  pending.value = false
}
watch(() => route.params.id, load, { immediate: true })
// The parent list refreshes itself; this keeps the open detail pane live.
onRealtimeChanged(load)

/** Bed counts changed, so the list's occupancy figures are now stale too. */
async function refreshAll() {
  await Promise.all([load(), refreshList()])
}

const isAdmin = computed(() => user.value?.role === STAFF_ROLE.ADMIN)
const cohortLabel = computed(() => (apartment.value?.cohort === 'MEN' ? 'Men' : 'Women'))

// Counts are derived from the beds we already have — no second request, and no
// chance of disagreeing with the table directly below them.
const counts = computed(() => {
  const beds = apartment.value?.beds ?? []
  return {
    total: beds.length,
    occupied: beds.filter((b) => b.occupied).length,
    outOfService: beds.filter((b) => b.status === 'OUT_OF_SERVICE').length,
  }
})

// ── Add beds ────────────────────────────────────────────────────────────────
const bedsOpen = ref(false)
const bedMode = ref('bulk')
const bedForm = reactive({ count: 2, scheme: 'alpha', label: '' })
const bedPending = ref(false)
const bedError = ref('')

const preview = computed(() =>
  previewLabels(bedForm.scheme, bedForm.count, (apartment.value?.beds ?? []).map((b) => b.label)),
)

async function submitBeds() {
  bedError.value = ''
  bedPending.value = true
  try {
    await addBeds(
      route.params.id,
      bedMode.value === 'bulk'
        ? { count: Number(bedForm.count), scheme: bedForm.scheme }
        : { label: bedForm.label.trim() },
    )
    notify.success('Beds added')
    bedsOpen.value = false
    bedForm.label = ''
    await refreshAll()
  } catch (err) {
    bedError.value = err?.data?.error ?? 'Could not add beds.'
  } finally {
    bedPending.value = false
  }
}

// ── File a maintenance request ──────────────────────────────────────────────
// The form itself moved to AppMaintenanceRequestDialog on 2026-08-07. It was
// written inline here and reachable from nowhere else, which is why the
// house-wide /maintenance queue had no way to file anything at all.
const reqOpen = ref(false)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Cohort and occupancy live here rather than in a settings card. Cohort is
         the one structurally important fact — it is what keeps the two cohorts
         in separate units — so it stays visible. -->
    <div class="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Button as-child variant="ghost" size="sm" class="lg:hidden" aria-label="Back to apartments">
        <NuxtLink to="/apartments"><ArrowLeft class="size-4" /></NuxtLink>
      </Button>
      <h2 class="font-heading text-[15px] font-semibold tracking-tight">
        {{ apartment?.name ?? 'Apartment' }}
      </h2>
      <div v-if="apartment" class="ml-auto flex items-center gap-3">
        <Badge variant="outline" class="text-[10px] uppercase tracking-wider">
          {{ cohortLabel }}
        </Badge>
        <span class="text-muted-foreground hidden text-xs sm:inline">
          <span class="text-foreground font-medium tabular-nums">
            {{ counts.occupied }} of {{ counts.total }}
          </span>
          occupied
          <template v-if="counts.outOfService">
            · <span class="text-warning">{{ counts.outOfService }} out</span>
          </template>
        </span>
        <AppApartmentEdit :apartment="apartment" @saved="refreshAll" />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="pending" class="text-muted-foreground text-sm">Loading…</div>

      <div v-else-if="apartment" class="flex flex-col gap-7">
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
              Beds
            </h3>
            <Button v-if="isAdmin" size="sm" variant="outline" @click="bedsOpen = true">
              <Plus class="size-4" /> Add beds
            </Button>
          </div>
          <AppBedTable :beds="apartment.beds" @changed="refreshAll" />
        </section>

        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
              Maintenance
            </h3>
            <Button size="sm" variant="outline" @click="reqOpen = true">
              <Plus class="size-4" /> File request
            </Button>
          </div>
          <AppMaintenanceList :requests="apartment.maintenanceRequests" @changed="load" />
        </section>
      </div>
    </div>
  </div>

  <!-- Add beds -->
  <Dialog v-model:open="bedsOpen">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader><DialogTitle>Add beds</DialogTitle></DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submitBeds">
        <Alert v-if="bedError" variant="destructive">
          <AlertDescription>{{ bedError }}</AlertDescription>
        </Alert>

        <AppField label="How">
          <RadioGroup v-model="bedMode" class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <RadioGroupItem id="bulk" value="bulk" />
              <Label for="bulk" class="font-normal">Several at once</Label>
            </div>
            <div class="flex items-center gap-2">
              <RadioGroupItem id="single" value="single" />
              <Label for="single" class="font-normal">One with a specific label</Label>
            </div>
          </RadioGroup>
        </AppField>

        <template v-if="bedMode === 'bulk'">
          <div class="flex gap-3">
            <AppField v-slot="{ id }" label="How many" class="flex-1">
              <Input :id="id" v-model="bedForm.count" type="number" min="1" max="24" />
            </AppField>
            <AppField label="Labelled" class="flex-1">
              <Select v-model="bedForm.scheme">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alpha">A, B, C…</SelectItem>
                  <SelectItem value="numeric">1, 2, 3…</SelectItem>
                </SelectContent>
              </Select>
            </AppField>
          </div>
          <!-- Show the labels before committing: bulk creation continues from
               the last existing bed rather than restarting, which is easy to
               get wrong in your head. -->
          <p class="text-muted-foreground text-xs">
            Will create <span class="text-foreground font-medium">{{ preview.join(', ') }}</span>
          </p>
        </template>

        <AppField v-else v-slot="{ id }" label="Label">
          <Input :id="id" v-model="bedForm.label" placeholder="E" required />
        </AppField>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="bedsOpen = false">Cancel</Button>
          <Button type="submit" :disabled="bedPending">Add</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <!-- The apartment is decided here, so no picker is shown. -->
  <AppMaintenanceRequestDialog
    v-model:open="reqOpen"
    :apartment-id="route.params.id"
    @created="load"
  />
</template>
