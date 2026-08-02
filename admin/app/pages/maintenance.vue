<script setup>
const { listRequests, listApartments } = useApartments()

// 'all' rather than '' — Reka UI reserves the empty string for "selection
// cleared" and throws if an item uses it as a value.
const ALL = 'all'

const status = ref('open')
const apartmentId = ref(ALL)
const requests = ref([])
const apartments = ref([])
const pending = ref(true)

const statuses = [
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'RESOLVED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'Any status', value: ALL },
]

async function load() {
  pending.value = true
  requests.value = await listRequests({
    status: status.value === ALL ? undefined : status.value,
    apartmentId: apartmentId.value === ALL ? undefined : apartmentId.value,
  })
  pending.value = false
}

const apartmentItems = computed(() => [
  { label: 'All apartments', value: ALL },
  ...apartments.value.map((a) => ({ label: a.name, value: a.id })),
])

apartments.value = await listApartments()
await load()
watch([status, apartmentId], load)
</script>

<template>
  <AppPage title="Maintenance" description="Open work across the facility.">
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <USelect v-model="status" :items="statuses" value-key="value" class="w-44" />
        <USelect v-model="apartmentId" :items="apartmentItems" value-key="value" class="w-52" />
      </div>

      <p v-if="pending" class="text-sm text-[var(--color-mute)]">Loading…</p>
      <AppMaintenanceList v-else :requests="requests" show-apartment @changed="load" />
    </div>
  </AppPage>
</template>
