<script setup>
// Parent route: the apartment list stays mounted while the detail child
// changes, so selecting an apartment does not re-fetch or re-scroll the list.
const route = useRoute()
const { listApartments } = useApartments()

const apartments = useState('apartments.list', () => [])
const pending = ref(true)

async function refresh() {
  apartments.value = await listApartments()
  pending.value = false
}
await refresh()
// Children call this after a mutation so occupancy counts stay honest.
provide('refreshApartments', refresh)

const selectedId = computed(() => route.params.id ?? null)
// On a phone there is only room for one pane: once an apartment is open the
// list steps aside.
const listHiddenOnMobile = computed(() => Boolean(selectedId.value))
</script>

<template>
  <AppPageHeader title="Apartments &amp; Beds">
    <template #actions>
      <AppApartmentCreate @created="refresh" />
    </template>
  </AppPageHeader>

  <div class="flex min-h-0 flex-1">
    <aside
      class="w-full shrink-0 overflow-y-auto border-r lg:w-[300px]"
      :class="listHiddenOnMobile ? 'hidden lg:block' : 'block'"
    >
      <AppApartmentList :apartments="apartments" :pending="pending" :selected-id="selectedId" />
    </aside>

    <div class="min-w-0 flex-1 overflow-y-auto">
      <NuxtPage />
    </div>
  </div>
</template>
