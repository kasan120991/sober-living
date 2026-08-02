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
import { money, inCredit, LEDGER_TYPES, LEDGER_CATEGORIES, categoryLabel } from '~/utils/money.js'
import { STAFF_ROLE } from '~/utils/roles.js'

const props = defineProps({
  residentId: { type: String, required: true },
  /** False once discharged — a closed stay still shows, it just cannot be billed. */
  canPost: { type: Boolean, default: false },
})
const emit = defineEmits(['posted'])

const { user } = useAuth()
const { listLedger, postLedgerEntry } = useResidents()
const notify = useNotify()

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

const open = ref(false)
const busy = ref(false)
const error = ref('')

const blank = () => ({
  type: 'CHARGE',
  category: 'RENT',
  amount: '',
  description: '',
  occurredAt: new Date().toISOString().slice(0, 10),
})
const form = reactive(blank())

// Only a charge carries a category — the database enforces it, so the form
// should not offer one where it would be rejected.
watch(
  () => form.type,
  (t) => {
    form.category = t === 'CHARGE' ? (form.category ?? 'RENT') : null
  },
)

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  Object.assign(form, blank())
})

async function submit() {
  error.value = ''
  busy.value = true
  try {
    await postLedgerEntry(props.residentId, {
      type: form.type,
      category: form.type === 'CHARGE' ? form.category : null,
      // Sent as typed. The server parses dollars to cents so one rounding rule
      // applies everywhere; multiplying by 100 here loses a cent on 12.10.
      amount: form.amount,
      description: form.description,
      occurredAt: form.occurredAt || null,
    })
    notify.success('Entry posted')
    open.value = false
    await load()
    emit('posted')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not post the entry.'
  } finally {
    busy.value = false
  }
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

      <Dialog v-if="canManage" v-model:open="open">
        <DialogTrigger as-child>
          <Button size="sm" variant="outline"><Plus class="size-4" /> Add entry</Button>
        </DialogTrigger>
        <DialogContent class="sm:max-w-[460px]">
          <DialogHeader><DialogTitle>Add a ledger entry</DialogTitle></DialogHeader>

          <form class="flex flex-col gap-4" @submit.prevent="submit">
            <Alert v-if="error" variant="destructive">
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>

            <div class="flex gap-3">
              <AppField label="Type" class="flex-1">
                <Select v-model="form.type">
                  <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="t in LEDGER_TYPES" :key="t.value" :value="t.value">
                      {{ t.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </AppField>

              <AppField v-if="form.type === 'CHARGE'" label="For" class="flex-1">
                <Select v-model="form.category">
                  <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="c in LEDGER_CATEGORIES" :key="c.value" :value="c.value">
                      {{ c.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </AppField>
            </div>

            <div class="flex gap-3">
              <AppField
                v-slot="{ id }"
                label="Amount"
                class="flex-1"
                description="Dollars, e.g. 650 or 20.50"
              >
                <Input :id="id" v-model="form.amount" inputmode="decimal" placeholder="650.00" required />
              </AppField>
              <AppField v-slot="{ id }" label="Date" class="flex-1" description="When it applies.">
                <Input :id="id" v-model="form.occurredAt" type="date" />
              </AppField>
            </div>

            <AppField
              v-slot="{ id }"
              label="Description"
              description="What this is for. It appears on the resident's ledger."
            >
              <Input :id="id" v-model="form.description" placeholder="Rent 2026-08" required />
            </AppField>

            <!-- Append-only is a property of the record, not a technicality —
                 say so where someone is about to write one. -->
            <p class="text-muted-foreground text-xs">
              Entries cannot be edited or deleted. A mistake is corrected by posting
              another entry.
            </p>

            <DialogFooter class="border-t pt-4">
              <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
              <Button type="submit" :disabled="busy">Post entry</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
  </section>
</template>
