<script setup>
// The lines behind a balance.
//
// The roster shows a number; this is where it comes from. A balance nobody can
// break down is not defensible to a resident disputing it or to anyone auditing
// the facility, so the record page always shows the entries, not just the total.
//
// Nothing here edits or deletes: the database refuses both. A mistake is
// corrected by posting an entry that points at the one it fixes.
import { Plus } from '@lucide/vue'
import { isoDate } from '~/composables/useResidents.js'
import { money, inCredit, categoryLabel } from '~/utils/money.js'
import { STAFF_ROLE } from '~/utils/roles.js'

const props = defineProps({
  residentId: { type: String, required: true },
  /** False once discharged — a closed stay still shows, it just cannot be billed. */
  canPost: { type: Boolean, default: false },
})
const emit = defineEmits(['posted'])

const { user } = useAuth()
const { listLedger } = useResidents()

const entries = ref([])
const balanceCents = ref(0)
const pending = ref(true)

// Posting money is a manager action. A tech can read a balance — answering
// "what do I owe" at the door should not need a manager — but not change one.
const canManage = computed(
  () =>
    props.canPost && [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

async function load() {
  pending.value = true
  const data = await listLedger(props.residentId)
  entries.value = data.entries
  balanceCents.value = data.balanceCents
  pending.value = false
}
await load()

// The dialog is a sibling component now, not a nested one with its own trigger,
// so the row menu on the roster can open the same implementation.
const entryOpen = ref(false)

async function onPosted() {
  await load()
  emit('posted')
}
</script>

<template>
  <section>
    <div class="mb-2 flex items-center justify-between gap-3">
      <div class="flex items-baseline gap-3">
        <h2 class="font-heading text-[15px] font-semibold tracking-tight">Ledger</h2>
        <span
          class="text-[13.5px] tabular-nums"
          :class="
            balanceCents === 0
              ? 'text-muted-foreground'
              : inCredit(balanceCents)
                ? 'text-success'
                : 'text-foreground font-medium'
          "
        >
          {{ money(balanceCents) }}
          <span class="text-muted-foreground font-normal">
            {{ inCredit(balanceCents) ? 'in credit' : balanceCents === 0 ? 'balance' : 'owed' }}
          </span>
        </span>
      </div>

      <Button v-if="canManage" size="sm" variant="outline" @click="entryOpen = true">
        <Plus class="size-4" /> Add entry
      </Button>
    </div>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="overflow-hidden rounded-md border">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th
                v-for="h in ['Date', 'Description', 'Type', 'Amount', 'Balance']"
                :key="h"
                class="bg-card text-muted-foreground border-b px-3 py-2 text-left text-[10.5px] font-semibold tracking-[0.1em] whitespace-nowrap uppercase"
                :class="['Amount', 'Balance'].includes(h) && 'text-right'"
              >
                {{ h }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in entries" :key="e.id" class="bg-card">
              <td class="h-12 border-b px-3 tabular-nums whitespace-nowrap">
                {{ isoDate(e.occurredAt) }}
              </td>
              <td class="h-12 max-w-[38ch] truncate border-b px-3">
                {{ e.description }}
                <span v-if="e.category" class="text-muted-foreground">
                  · {{ categoryLabel(e.category) }}
                </span>
                <span v-if="e.corrects" class="text-warning">· correction</span>
              </td>
              <td class="h-12 border-b px-3 whitespace-nowrap">
                <Badge variant="outline" class="tracking-wider text-[10px] uppercase">
                  {{ e.type.toLowerCase() }}
                </Badge>
              </td>
              <td class="h-12 border-b px-3 text-right tabular-nums whitespace-nowrap">
                <span :class="e.type === 'CHARGE' ? 'text-foreground' : 'text-success'">
                  {{ e.type === 'CHARGE' ? '' : '−' }}{{ money(e.amountCents) }}
                </span>
              </td>
              <td
                class="text-muted-foreground h-12 border-b px-3 text-right tabular-nums whitespace-nowrap"
              >
                {{ money(e.runningCents) }}
              </td>
            </tr>

            <tr v-if="!entries.length">
              <td colspan="5" class="bg-card text-muted-foreground px-3 py-8 text-center text-sm">
                Nothing billed yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <AppLedgerEntryDialog
      v-model:open="entryOpen"
      :resident-id="residentId"
      :balance-cents="balanceCents"
      @posted="onPosted"
    />
  </section>
</template>
