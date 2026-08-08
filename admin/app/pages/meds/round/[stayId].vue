<script setup>
// One resident's step in round mode — the FULL-SCREEN shell for AppMedPassForm,
// AppMedPassSheet's opposite number and /checks/round/[id]'s twin.
//
// Neither shell owns a rule: every one lives in the form. This supplies a
// heading, a position, and a footer.
//
// On save it returns to the PICKER, not to the next resident. A round has no
// forced sequence — staff walk the house in whatever order the house allows.
const route = useRoute()
const router = useRouter()
const { getMeds } = useMeds()

const stayId = computed(() => route.params.stayId)
const form = ref(null)

// Reuses the board's own read rather than a per-resident endpoint, so the
// position line cannot disagree with the picker it came from.
const board = ref(null)
board.value = await getMeds()

const current = computed(() => {
  const passes = board.value?.passes ?? []
  return passes.find((p) => p.residents.some((r) => r.stayId === stayId.value)) ?? null
})
const people = computed(() => current.value?.residents ?? [])
const index = computed(() => people.value.findIndex((r) => r.stayId === stayId.value))
const subject = computed(() => people.value[index.value] ?? null)

const stay = computed(() =>
  subject.value ? { stayId: subject.value.stayId, fullName: subject.value.fullName } : null,
)

function onSaved() {
  router.push('/meds/round')
}
</script>

<template>
  <AppPage
    :title="subject?.fullName ?? 'Med pass'"
    :back="{ label: 'Round', to: '/meds/round' }"
  >
    <template #description>
      <template v-if="subject">
        {{ [subject.apartmentName, subject.bedLabel].filter(Boolean).join(' · ') }}
        <template v-if="index >= 0">
          · <span class="tabular-nums">{{ index + 1 }}</span> of
          <span class="tabular-nums">{{ people.length }}</span>
        </template>
      </template>
    </template>

    <p v-if="!subject" class="text-muted-foreground text-sm">
      This resident is not on the current pass.
    </p>

    <div v-else class="flex flex-col gap-4">
      <!-- Edge to edge on a phone: the form's own padding is the page's. -->
      <div class="-mx-3">
        <AppMedPassForm ref="form" :stay="stay" :active="true" @saved="onSaved" />
      </div>

      <div v-if="form?.ready && form?.openDoses?.length" class="flex items-center gap-3 border-t pt-4">
        <span class="text-muted-foreground text-xs tabular-nums">
          {{ form.markedCount }} of {{ form.openDoses.length }} marked
        </span>
        <Button
          class="ms-auto"
          size="lg"
          :disabled="form.pending || !form.canSave"
          @click="form.submit()"
        >
          Save pass
        </Button>
      </div>
    </div>
  </AppPage>
</template>
