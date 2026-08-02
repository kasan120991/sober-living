<script setup>
import { STAFF_ROLE } from '~/utils/roles.js'
import { previewLabels } from '~/composables/useApartments.js'

const route = useRoute()
const { user } = useAuth()
const { getApartment, addBeds, createRequest } = useApartments()
const toast = useToast()

const refreshList = inject('refreshApartments', () => {})

const apartment = ref(null)
const pending = ref(true)

async function load() {
  pending.value = true
  apartment.value = await getApartment(route.params.id)
  pending.value = false
}
watch(() => route.params.id, load, { immediate: true })

/** Bed counts changed, so the list's occupancy figures are now stale too. */
async function refreshAll() {
  await Promise.all([load(), refreshList()])
}

const isAdmin = computed(() => user.value?.role === STAFF_ROLE.ADMIN)

// ── Add beds ────────────────────────────────────────────────────────────────
const bedsOpen = ref(false)
const bedMode = ref('bulk')
const bedForm = reactive({ count: 2, scheme: 'alpha', label: '' })
const bedPending = ref(false)
const bedError = ref('')

const preview = computed(() =>
  previewLabels(
    bedForm.scheme,
    bedForm.count,
    (apartment.value?.beds ?? []).map((b) => b.label),
  ),
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
    toast.add({ title: 'Beds added', color: 'success', icon: 'i-lucide-check' })
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
const reqOpen = ref(false)
const reqForm = reactive({ title: '', description: '', priority: 'NORMAL' })
const reqPending = ref(false)
const reqError = ref('')

const priorities = [
  { label: 'Low', value: 'LOW' },
  { label: 'Normal', value: 'NORMAL' },
  { label: 'Urgent', value: 'URGENT' },
]

async function submitRequest() {
  reqError.value = ''
  reqPending.value = true
  try {
    await createRequest({ apartmentId: route.params.id, ...reqForm })
    toast.add({ title: 'Request filed', color: 'success', icon: 'i-lucide-check' })
    reqOpen.value = false
    Object.assign(reqForm, { title: '', description: '', priority: 'NORMAL' })
    await load()
  } catch (err) {
    reqError.value = err?.data?.error ?? 'Could not file the request.'
  } finally {
    reqPending.value = false
  }
}

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
</script>

<template>
  <UDashboardPanel id="apartment-detail">
    <template #header>
      <UDashboardNavbar
        :title="apartment?.name ?? 'Apartment'"
        :ui="{
          root: 'border-b border-[var(--color-hairline)] bg-[var(--color-elevated)]',
          title: 'text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]',
        }"
      >
        <template #leading>
          <!-- Back to the list. Only meaningful on a phone, where the list is
               hidden while a detail route is open. -->
          <UButton
            to="/apartments"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            class="lg:hidden"
            aria-label="Back to apartments"
          />
        </template>

        <!-- Cohort and occupancy live here rather than in a settings card.
             Cohort is the one structurally important fact — it is what keeps the
             two cohorts in separate units — so it stays visible. Timezone and
             address are set once at intake and moved into the edit dialog. -->
        <template #right>
          <div v-if="apartment" class="flex items-center gap-3">
            <span
              class="rounded-[3px] border border-[var(--color-hairline)] px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-body)]"
            >
              {{ cohortLabel }}
            </span>
            <span class="hidden text-[12.5px] text-[var(--color-mute)] sm:inline">
              <span class="font-medium tabular-nums text-[var(--color-ink)]">
                {{ counts.occupied }} of {{ counts.total }}
              </span>
              occupied
              <template v-if="counts.outOfService">
                ·
                <span class="text-[var(--color-warning-deep)]">{{ counts.outOfService }} out</span>
              </template>
            </span>
            <AppApartmentEdit :apartment="apartment" @saved="refreshAll" />
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="pending" class="text-sm text-[var(--color-mute)]">Loading…</div>

      <div v-else-if="apartment" class="flex flex-col gap-7">
        <!-- Beds -->
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mute)]">
              Beds
            </h2>
            <UButton
              v-if="isAdmin"
              icon="i-lucide-plus"
              size="sm"
              color="neutral"
              variant="outline"
              label="Add beds"
              @click="bedsOpen = true"
            />
          </div>
          <AppBedTable :beds="apartment.beds" @changed="refreshAll" />
        </section>

        <!-- Maintenance -->
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mute)]">
              Maintenance
            </h2>
            <UButton
              icon="i-lucide-plus"
              size="sm"
              color="neutral"
              variant="outline"
              label="File request"
              @click="reqOpen = true"
            />
          </div>
          <AppMaintenanceList :requests="apartment.maintenanceRequests" @changed="load" />
        </section>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Add beds -->
  <UModal v-model:open="bedsOpen" title="Add beds">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submitBeds">
        <UAlert v-if="bedError" color="error" variant="soft" :description="bedError" />

        <UFormField label="How" name="mode">
          <URadioGroup
            v-model="bedMode"
            :items="[
              { label: 'Several at once', value: 'bulk' },
              { label: 'One with a specific label', value: 'single' },
            ]"
            value-key="value"
          />
        </UFormField>

        <template v-if="bedMode === 'bulk'">
          <div class="flex gap-3">
            <UFormField label="How many" name="count" class="flex-1">
              <UInput v-model="bedForm.count" type="number" min="1" max="24" class="w-full" />
            </UFormField>
            <UFormField label="Labelled" name="scheme" class="flex-1">
              <USelect
                v-model="bedForm.scheme"
                :items="[
                  { label: 'A, B, C…', value: 'alpha' },
                  { label: '1, 2, 3…', value: 'numeric' },
                ]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </div>
          <!-- Show the labels before committing: bulk creation continues from
               the last existing bed rather than restarting, which is easy to
               get wrong in your head. -->
          <p class="text-xs text-[var(--color-mute)]">
            Will create
            <span class="font-mono text-[var(--color-ink)]">{{ preview.join(', ') }}</span>
          </p>
        </template>

        <UFormField v-else label="Label" name="label">
          <UInput v-model="bedForm.label" placeholder="E" class="w-full" required />
        </UFormField>

        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="bedsOpen = false" />
          <UButton type="submit" color="primary" :loading="bedPending" label="Add" />
        </div>
      </form>
    </template>
  </UModal>

  <!-- File maintenance request -->
  <UModal v-model:open="reqOpen" title="File maintenance request">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submitRequest">
        <UAlert v-if="reqError" color="error" variant="soft" :description="reqError" />

        <UFormField label="What is wrong" name="title">
          <UInput v-model="reqForm.title" placeholder="Window latch broken" class="w-full" required />
        </UFormField>

        <UFormField label="Details" name="description">
          <UTextarea v-model="reqForm.description" :rows="3" class="w-full" />
        </UFormField>

        <UFormField label="Priority" name="priority">
          <USelect v-model="reqForm.priority" :items="priorities" value-key="value" class="w-full" />
        </UFormField>

        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="reqOpen = false" />
          <UButton type="submit" color="primary" :loading="reqPending" label="File request" />
        </div>
      </form>
    </template>
  </UModal>
</template>
