<script setup>
const { listRequests, listApartments } = useApartments()

// Reka's Select reserves the empty string for "selection cleared".
const ALL = 'all'

const status = ref('open')
const apartmentId = ref(ALL)
const requests = ref([])
const apartments = ref([])
const pending = ref(true)

async function load() {
  pending.value = true
  requests.value = await listRequests({
    status: status.value === ALL ? undefined : status.value,
    apartmentId: apartmentId.value === ALL ? undefined : apartmentId.value,
  })
  pending.value = false
}

apartments.value = await listApartments()
await load()
watch([status, apartmentId], load)
</script>

<template>
  <AppPage title="Maintenance" description="Open work across the facility.">
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <Select v-model="status">
          <SelectTrigger class="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem :value="ALL">Any status</SelectItem>
          </SelectContent>
        </Select>

        <Select v-model="apartmentId">
          <SelectTrigger class="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">All apartments</SelectItem>
            <SelectItem v-for="a in apartments" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>
      <AppMaintenanceList v-else :requests="requests" show-apartment @changed="load" />
    </div>
  </AppPage>
</template>
