<script setup>
import { STAFF_ROLE } from '~/utils/roles.js'

// Only rendered when someone is unhoused. A healthy roster costs no pixels —
// the same rule the census will use for overdue residents.
const props = defineProps({
  unhoused: { type: Array, default: () => [] },
})
const emit = defineEmits(['assigned'])

const { user } = useAuth()
const { assignBed } = useResidents()
const toast = useToast()

const canAssign = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)
const busy = ref(null)

async function place(row) {
  busy.value = row.id
  try {
    await assignBed(row.id, row.freeBed.id)
    toast.add({
      title: `${row.fullName} → ${row.freeBed.label}`,
      color: 'success',
      icon: 'i-lucide-check',
    })
    emit('assigned')
  } catch (err) {
    toast.add({ title: err?.data?.error ?? 'Could not assign the bed.', color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div v-if="unhoused.length" class="flex flex-col gap-2">
    <div
      v-for="row in unhoused"
      :key="row.id"
      class="flex flex-wrap items-center gap-2 rounded-[var(--ui-radius)] border border-[rgba(245,166,35,.32)] bg-[var(--color-warning-soft)] px-3 py-2.5 text-[13px] text-[var(--color-warning-deep)]"
    >
      <UIcon name="i-lucide-bed" class="size-4 shrink-0" aria-hidden="true" />
      <span>
        <NuxtLink :to="`/residents/${row.id}`" class="font-semibold underline-offset-2 hover:underline">
          {{ row.fullName }}
        </NuxtLink>
        has no bed.
        <template v-if="row.freeBed">
          <span class="font-mono">{{ row.freeBed.label }}</span> is free in their cohort.
        </template>
        <template v-else>No bed is free in their cohort.</template>
      </span>

      <UButton
        v-if="row.freeBed && canAssign"
        size="xs"
        color="neutral"
        variant="outline"
        class="ms-auto"
        :loading="busy === row.id"
        :label="`Assign ${row.freeBed.label}`"
        @click="place(row)"
      />
    </div>
  </div>
</template>
