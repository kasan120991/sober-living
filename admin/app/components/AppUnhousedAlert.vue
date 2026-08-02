<script setup>
import { BedSingle } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'

defineProps({ unhoused: { type: Array, default: () => [] } })
const emit = defineEmits(['assigned'])

const { user } = useAuth()
const { assignBed } = useResidents()
const notify = useNotify()

const canAssign = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)
const busy = ref(null)

async function place(row) {
  busy.value = row.id
  try {
    await assignBed(row.id, row.freeBed.id)
    notify.success(`${row.fullName} → ${row.freeBed.label}`)
    emit('assigned')
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not assign the bed.')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <!-- Only rendered when someone is unhoused. A healthy roster costs no pixels —
       the same rule the census will use for overdue residents. -->
  <div v-if="unhoused.length" class="flex flex-col gap-2">
    <div
      v-for="row in unhoused"
      :key="row.id"
      class="border-warning/40 bg-warning/10 text-warning flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 text-sm"
    >
      <BedSingle class="size-4 shrink-0" aria-hidden="true" />
      <span class="text-foreground">
        <NuxtLink :to="`/residents/${row.id}`" class="font-semibold underline-offset-2 hover:underline">
          {{ row.fullName }}
        </NuxtLink>
        has no bed.
        <template v-if="row.freeBed">
          <span class="font-mono">{{ row.freeBed.label }}</span> is free in their cohort.
        </template>
        <template v-else>No bed is free in their cohort.</template>
      </span>

      <Button v-if="row.freeBed && canAssign" size="sm" variant="outline" class="ml-auto"
              :disabled="busy === row.id" @click="place(row)">
        Assign {{ row.freeBed.label }}
      </Button>
    </div>
  </div>
</template>
