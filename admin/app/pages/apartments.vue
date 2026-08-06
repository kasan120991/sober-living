<script setup>
import { STAFF_ROLE } from '~/utils/roles.js'

// Parent route: the apartment list stays mounted while the detail child
// changes, so selecting an apartment does not re-fetch or re-scroll the list.
const route = useRoute()
const { user } = useAuth()
const { listApartments, listRemovedApartments } = useApartments()

const apartments = useState('apartments.list', () => [])
const removed = ref([])
const pending = ref(true)

// Presentation only — /apartments/removed is admin-gated server-side.
const isAdmin = computed(() => user.value?.role === STAFF_ROLE.ADMIN)

async function refresh() {
  ;[apartments.value, removed.value] = await Promise.all([
    listApartments(),
    isAdmin.value ? listRemovedApartments() : [],
  ])
  pending.value = false
}
await refresh()
// Children call this after a mutation so occupancy counts stay honest.
provide('refreshApartments', refresh)
// Another device's mutation calls it too, via the invalidation socket.
onRealtimeChanged(refresh)

const selectedId = computed(() => route.params.id ?? null)
// On a phone there is only room for one pane: once an apartment is open the
// list steps aside.
const listHiddenOnMobile = computed(() => Boolean(selectedId.value))
</script>

<template>
  <AppPageHeader />

  <!-- This page is a two-panel layout rather than AppPage's single column, so
       it mounts the heading itself. Same component, same result. -->
  <div class="px-4 pt-4 pb-3">
    <AppPageHeading
      title="Apartments &amp; Beds"
      :description="`${apartments.length} apartments across both cohorts.`"
    >
      <template #actions>
        <AppApartmentCreate @created="refresh" />
      </template>
    </AppPageHeading>
  </div>

  <div class="flex min-h-0 flex-1">
    <aside
      class="w-full shrink-0 overflow-y-auto border-r lg:w-[300px]"
      :class="listHiddenOnMobile ? 'hidden lg:block' : 'block'"
    >
      <AppApartmentList
        :apartments="apartments"
        :removed="removed"
        :pending="pending"
        :selected-id="selectedId"
      />
    </aside>

    <div class="min-w-0 flex-1 overflow-y-auto">
      <NuxtPage />
    </div>
  </div>
</template>
