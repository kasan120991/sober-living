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
  <UDashboardPanel
    id="apartment-list"
    :default-size="26"
    :min-size="20"
    :max-size="34"
    resizable
    :class="listHiddenOnMobile ? 'hidden lg:flex' : 'flex'"
  >
    <template #header>
      <UDashboardNavbar
        title="Apartments & Beds"
        :ui="{
          root: 'border-b border-[var(--color-hairline)] bg-[var(--color-elevated)]',
          title: 'text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]',
        }"
      >
        <template #right>
          <AppApartmentCreate @created="refresh" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <AppApartmentList :apartments="apartments" :pending="pending" :selected-id="selectedId" />
    </template>
  </UDashboardPanel>

  <NuxtPage />
</template>
