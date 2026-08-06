<script setup>
// Intake, in four sections.
//
// It was one long scroll, which was fine at eight fields and is not at
// nineteen. The sections are the ones a person doing an intake actually works
// through: who they are, where they are going, how to reach them, who pays.
//
// The step nav is clickable as well as sequential — an intake is often done
// with a folder open and facts arriving out of order, and forcing Next through
// four screens to fix a typo in the first one is how forms get abandoned.
// Nothing is submitted until Complete intake, and the whole thing lands in one
// transaction on the server.
import { Check, ChevronLeft, ChevronRight, MapPin, Phone, Shield, User } from '@lucide/vue'

// Takes v-model:open and no trigger of its own — the roster and the
// dashboard's quick actions both open it (module 1's shared-dialog rule).
const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'intaken'])
const { intakeResident, availableBeds, listPrograms } = useResidents()
const notify = useNotify()

const SECTIONS = [
  { key: 'personal', label: 'Personal', icon: User },
  { key: 'program', label: 'Program & Room', icon: MapPin },
  { key: 'contact', label: 'Contact', icon: Phone },
  { key: 'insurance', label: 'Insurance', icon: Shield },
]

const open = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})
const pending = ref(false)
const error = ref('')
const section = ref('personal')
const NO_BED = 'none'

const blank = () => ({
  firstName: '', lastName: '', cohort: 'MEN', dateOfBirth: '', ssnLast4: '', intakeNotes: '',
  programId: '', intakeAt: new Date().toISOString().slice(0, 10), expectedDischargeAt: '',
  sobrietyDate: '', bedId: NO_BED, referralSource: '',
  email: '', phone: '',
  contactName: '', contactRelationship: '', contactPhone: '',
  insProvider: '', insPolicyNumber: '', insGroupNumber: '', insPolicyHolder: '',
})
const form = reactive(blank())

const programs = ref([])
// Only beds in matching-cohort apartments are offered — the composite foreign
// keys would refuse anything else, so filtering here saves a pointless error
// rather than being the enforcement.
const beds = ref([])

async function loadBeds() {
  beds.value = await availableBeds(form.cohort)
  if (!beds.value.some((b) => b.id === form.bedId)) form.bedId = NO_BED
}
watch(() => form.cohort, loadBeds)

watch(open, async (isOpen) => {
  if (!isOpen) return
  error.value = ''
  section.value = 'personal'
  Object.assign(form, blank())
  programs.value = await listPrograms()
  // Lowest level first, so a new resident starts on Orientation unless someone
  // deliberately changes it.
  form.programId = programs.value[0]?.id ?? ''
  await loadBeds()
})

const index = computed(() => SECTIONS.findIndex((s) => s.key === section.value))
const isLast = computed(() => index.value === SECTIONS.length - 1)
const go = (delta) => {
  const next = SECTIONS[index.value + delta]
  if (next) section.value = next.key
}

// A name is the only thing a record cannot exist without. Everything else can
// be filled in later, so the button says so rather than blocking on a section
// the person at the door has not got to yet.
const nameMissing = computed(() => !form.firstName.trim() || !form.lastName.trim())

async function submit() {
  if (nameMissing.value) {
    section.value = 'personal'
    error.value = 'A first and last name are required.'
    return
  }
  error.value = ''
  pending.value = true
  try {
    await intakeResident({
      firstName: form.firstName,
      lastName: form.lastName,
      cohort: form.cohort,
      dateOfBirth: form.dateOfBirth || null,
      ssnLast4: form.ssnLast4 || null,
      intakeNotes: form.intakeNotes || null,
      phone: form.phone || null,
      email: form.email || null,
      programId: form.programId || null,
      intakeAt: form.intakeAt || null,
      expectedDischargeAt: form.expectedDischargeAt || null,
      sobrietyDate: form.sobrietyDate || null,
      referralSource: form.referralSource || null,
      bedId: form.bedId === NO_BED ? null : form.bedId,
      insurance: form.insProvider
        ? {
            provider: form.insProvider,
            policyNumber: form.insPolicyNumber,
            groupNumber: form.insGroupNumber || null,
            policyHolder: form.insPolicyHolder || null,
          }
        : undefined,
      emergencyContact: form.contactName
        ? {
            name: form.contactName,
            relationship: form.contactRelationship || null,
            phone: form.contactPhone,
          }
        : undefined,
    })
    notify.success(`${form.firstName} ${form.lastName} intaken`)
    open.value = false
    emit('intaken')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not complete the intake.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="gap-0 p-0 sm:max-w-[720px]">
      <DialogHeader class="border-b px-5 py-4">
        <DialogTitle>Intake a resident</DialogTitle>
        <DialogDescription>
          Only a name is required. Everything else can be added to the record later.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col sm:flex-row">
        <!-- Step nav. Horizontal and scrollable on a phone, where a 160px
             sidebar would leave nothing for the fields. -->
        <nav
          class="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-[184px] sm:flex-col sm:overflow-visible sm:border-e sm:border-b-0 sm:p-3"
          aria-label="Intake sections"
        >
          <button
            v-for="(s, i) in SECTIONS"
            :key="s.key"
            type="button"
            class="flex items-center gap-2 rounded-md px-2.5 py-2 text-start text-[13px] whitespace-nowrap transition-colors"
            :class="
              section === s.key
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            "
            :aria-current="section === s.key ? 'step' : undefined"
            @click="section = s.key"
          >
            <component :is="s.icon" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ s.label }}</span>
            <Check
              v-if="i < index"
              class="text-success ms-auto hidden size-3.5 shrink-0 sm:block"
              aria-hidden="true"
            />
          </button>
        </nav>

        <form class="min-w-0 flex-1" @submit.prevent="submit">
          <div class="max-h-[min(26rem,55vh)] overflow-y-auto p-5">
            <Alert v-if="error" variant="destructive" class="mb-4">
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>

            <!-- ── Personal ─────────────────────────────────────────────── -->
            <div v-show="section === 'personal'" class="flex flex-col gap-4">
              <div class="flex gap-3">
                <AppField v-slot="{ id }" label="First name" class="flex-1">
                  <Input :id="id" v-model="form.firstName" autocomplete="off" />
                </AppField>
                <AppField v-slot="{ id }" label="Last name" class="flex-1">
                  <Input :id="id" v-model="form.lastName" autocomplete="off" />
                </AppField>
              </div>

              <div class="flex gap-3">
                <AppField v-slot="{ id }" label="Date of birth" class="flex-1">
                  <Input :id="id" v-model="form.dateOfBirth" type="date" />
                </AppField>
                <!-- Last four only. The server and a CHECK constraint both
                     refuse anything else; the facility has no use for a whole
                     SSN and holding one turns a records breach into an
                     identity-theft breach. -->
                <AppField
                  v-slot="{ id }"
                  label="SSN (last 4)"
                  class="w-40"
                  description="Last four digits only."
                >
                  <Input
                    :id="id"
                    v-model="form.ssnLast4"
                    inputmode="numeric"
                    maxlength="4"
                    placeholder="0000"
                    autocomplete="off"
                  />
                </AppField>
              </div>

              <AppField
                v-slot="{ id }"
                label="Intake notes"
                description="Observations or requirements from the door. Disclosable like any other record."
              >
                <Textarea :id="id" v-model="form.intakeNotes" rows="4" />
              </AppField>
            </div>

            <!-- ── Program & Room ───────────────────────────────────────── -->
            <div v-show="section === 'program'" class="flex flex-col gap-4">
              <div class="flex gap-3">
                <!-- Cohort is not on the reference form, but it is structural
                     here: it decides which apartments this person can ever be
                     housed in, and the database refuses a mismatch. -->
                <AppField
                  label="Cohort"
                  class="flex-1"
                  description="Decides which apartments they can be housed in."
                >
                  <Select v-model="form.cohort">
                    <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MEN">Men</SelectItem>
                      <SelectItem value="WOMEN">Women</SelectItem>
                    </SelectContent>
                  </Select>
                </AppField>

                <AppField label="Program" class="flex-1" description="Starts on Orientation.">
                  <Select v-model="form.programId">
                    <SelectTrigger class="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="p in programs" :key="p.id" :value="p.id">
                        {{ p.name }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </AppField>
              </div>

              <div class="flex gap-3">
                <AppField v-slot="{ id }" label="Admission date" class="flex-1">
                  <Input :id="id" v-model="form.intakeAt" type="date" />
                </AppField>
                <AppField v-slot="{ id }" label="Expected out" class="flex-1">
                  <Input :id="id" v-model="form.expectedDischargeAt" type="date" />
                </AppField>
              </div>

              <div class="flex gap-3">
                <AppField
                  v-slot="{ id }"
                  label="Sobriety date"
                  class="flex-1"
                  description="What they count from."
                >
                  <Input :id="id" v-model="form.sobrietyDate" type="date" />
                </AppField>
                <AppField
                  label="Bed"
                  class="flex-1"
                  description="Free beds in matching-cohort apartments."
                >
                  <Select v-model="form.bedId">
                    <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem :value="NO_BED">No bed yet</SelectItem>
                      <SelectItem v-for="b in beds" :key="b.id" :value="b.id">
                        {{ b.label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </AppField>
              </div>

              <AppField v-slot="{ id }" label="Referral source">
                <Input :id="id" v-model="form.referralSource" placeholder="Fulton County drug court" />
              </AppField>
            </div>

            <!-- ── Contact ──────────────────────────────────────────────── -->
            <div v-show="section === 'contact'" class="flex flex-col gap-4">
              <AppField v-slot="{ id }" label="Email address">
                <Input :id="id" v-model="form.email" type="email" placeholder="name@example.com" />
              </AppField>

              <AppField v-slot="{ id }" label="Phone number">
                <Input :id="id" v-model="form.phone" type="tel" placeholder="(555) 000-0000" />
              </AppField>

              <div class="border-t pt-4">
                <p class="text-muted-foreground mb-3 text-[11px] tracking-wider uppercase">
                  Emergency contact
                </p>
                <div class="flex flex-col gap-3">
                  <div class="flex gap-3">
                    <AppField v-slot="{ id }" label="Name" class="flex-1">
                      <Input :id="id" v-model="form.contactName" />
                    </AppField>
                    <AppField v-slot="{ id }" label="Relationship" class="w-40">
                      <Input :id="id" v-model="form.contactRelationship" placeholder="Parent" />
                    </AppField>
                  </div>
                  <AppField v-slot="{ id }" label="Contact phone">
                    <Input :id="id" v-model="form.contactPhone" placeholder="(555) 000-0000" />
                  </AppField>
                </div>
                <!-- 42 CFR Part 2: being listed here does not authorise telling
                     this person anything. Consent is separate and not built. -->
                <p class="text-muted-foreground mt-2 text-xs">
                  Listing a contact does not authorise disclosure to them.
                </p>
              </div>
            </div>

            <!-- ── Insurance ────────────────────────────────────────────── -->
            <div v-show="section === 'insurance'" class="flex flex-col gap-4">
              <AppField v-slot="{ id }" label="Insurance provider">
                <Input :id="id" v-model="form.insProvider" placeholder="Blue Cross Blue Shield" />
              </AppField>

              <div class="flex gap-3">
                <AppField v-slot="{ id }" label="Policy number" class="flex-1">
                  <Input :id="id" v-model="form.insPolicyNumber" placeholder="ABC123456789" />
                </AppField>
                <AppField v-slot="{ id }" label="Group number" class="flex-1">
                  <Input :id="id" v-model="form.insGroupNumber" placeholder="GRP12345" />
                </AppField>
              </div>

              <!-- Left blank means the resident holds the policy. Typing "same
                   as client" would make that fact unqueryable. -->
              <AppField
                v-slot="{ id }"
                label="Policy holder"
                description="Leave blank if the resident is the policy holder."
              >
                <Input :id="id" v-model="form.insPolicyHolder" placeholder="Name" />
              </AppField>

              <p class="text-muted-foreground text-xs">
                A provider and a policy number are recorded together or not at all.
              </p>
            </div>
          </div>

          <DialogFooter class="flex-row items-center justify-between border-t px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              :disabled="index === 0"
              @click="go(-1)"
            >
              <ChevronLeft class="size-4" /> Back
            </Button>

            <div class="flex items-center gap-2">
              <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
              <Button v-if="!isLast" type="button" @click="go(1)">
                Next <ChevronRight class="size-4" />
              </Button>
              <Button v-else type="submit" :disabled="pending">
                <Check class="size-4" /> {{ pending ? 'Saving…' : 'Complete intake' }}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </div>
    </DialogContent>
  </Dialog>
</template>
