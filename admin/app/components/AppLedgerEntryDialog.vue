<script setup>
// Posting a line to a resident's ledger.
//
// Extracted from AppLedger so it can be opened from anywhere — the ledger panel
// on the record page and the roster's row menu both use this one. It takes no
// trigger of its own on purpose: a component that owns its trigger can only be
// opened from where it is rendered, which is what forced this extraction.
//
// It fetches nothing. POST /residents/:id/ledger resolves the active stay
// server-side, so there is no reason to load a ledger to append one line to it.
import { money, inCredit, LEDGER_TYPES, LEDGER_CATEGORIES } from '~/utils/money.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** Nullable: the roster binds this from a row ref that is null while closed. */
  residentId: { type: String, default: null },
  /** From a row menu you are not on the person's page, so the title must name them. */
  residentName: { type: String, default: '' },
  /** 'PAYMENT' from a roster row — the common reason to open this from a list. */
  defaultType: { type: String, default: 'CHARGE' },
  /** Optional context. The roster already has it; the record page passes it too. */
  balanceCents: { type: Number, default: null },
  /**
   * With no residentId, the form grows a resident picker — the dashboard's
   * quick action opens this with nobody chosen yet. Rows: { id, fullName }.
   */
  residents: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'posted'])

const { postLedgerEntry } = useResidents()
const notify = useNotify()

const busy = ref(false)
const error = ref('')

const blank = () => ({
  type: props.defaultType,
  category: props.defaultType === 'CHARGE' ? 'RENT' : null,
  amount: '',
  description: '',
  occurredAt: new Date().toISOString().slice(0, 10),
})
const form = reactive(blank())
const pickedResidentId = ref('')

/** The resident this entry lands on — bound by the caller, or picked in-form. */
const effectiveResidentId = computed(() => props.residentId ?? (pickedResidentId.value || null))

// Only a charge carries a category — the database enforces it, so the form
// should not offer one where it would be rejected.
watch(
  () => form.type,
  (t) => {
    form.category = t === 'CHARGE' ? (form.category ?? 'RENT') : null
  },
)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = ''
    pickedResidentId.value = ''
    Object.assign(form, blank())
  },
)

async function submit() {
  error.value = ''
  busy.value = true
  try {
    await postLedgerEntry(effectiveResidentId.value, {
      type: form.type,
      category: form.type === 'CHARGE' ? form.category : null,
      // Sent as typed. The server parses dollars to cents so one rounding rule
      // applies everywhere; multiplying by 100 here loses a cent on 12.10.
      amount: form.amount,
      description: form.description,
      occurredAt: form.occurredAt || null,
    })
    notify.success('Entry posted')
    emit('update:open', false)
    emit('posted')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not post the entry.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>Add a ledger entry</DialogTitle>
        <DialogDescription>
          <template v-if="residentName">{{ residentName }}</template>
          <template v-if="residentName && balanceCents != null"> · </template>
          <template v-if="balanceCents != null">
            {{ money(balanceCents) }}
            {{ inCredit(balanceCents) ? 'in credit' : balanceCents === 0 ? 'balance' : 'owed' }}
          </template>
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField v-if="!residentId" label="Resident" required>
          <Select v-model="pickedResidentId" required>
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Whose ledger?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="r in residents" :key="r.id" :value="r.id">
                {{ r.fullName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </AppField>

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

        <!-- Append-only is a property of the record, not a technicality — say so
             where someone is about to write one. -->
        <p class="text-muted-foreground text-xs">
          Entries cannot be edited or deleted. A mistake is corrected by posting another
          entry.
        </p>

        <DialogFooter class="border-t pt-4">
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="busy || !effectiveResidentId">Post entry</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
