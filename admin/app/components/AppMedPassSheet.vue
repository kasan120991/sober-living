<script setup>
// The DESKTOP shell for one resident's med pass — a side drawer over the board,
// which on a desktop is itself the picker, so a pass is a detour from a page you
// keep in view.
//
// On the phone and the tablet the equivalent is /meds/round/[stayId], a
// full-screen step. Both shells render AppMedPassForm and neither owns a rule —
// see that component's header. AppCheckSheet's twin, deliberately.
import { Check } from '@lucide/vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** `{ stayId, fullName }` */
  stay: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'saved'])

const form = ref(null)

function onSaved() {
  emit('update:open', false)
  emit('saved')
}
</script>

<template>
  <Sheet :open="open" @update:open="(v) => emit('update:open', v)">
    <SheetContent side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
      <SheetHeader class="border-b p-4">
        <!-- pe-9 reserves the lane SheetContent's own absolute close button
             occupies — the AppRollSheet lesson, inherited by every sheet here. -->
        <div class="flex items-start gap-2 pe-9">
          <SheetTitle class="min-w-0 flex-1 text-[15px]">
            {{ stay?.fullName ?? 'Med pass' }}
          </SheetTitle>
        </div>
        <p v-if="form?.openDoses?.length" class="text-muted-foreground text-xs">
          <span class="tabular-nums">{{ form.openDoses.length }}</span>
          {{ form.openDoses.length === 1 ? 'dose' : 'doses' }} to record
        </p>
      </SheetHeader>

      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AppMedPassForm ref="form" :stay="stay" :active="open" @saved="onSaved" />
      </div>

      <SheetFooter v-if="form?.ready && form?.openDoses?.length" class="border-t p-4">
        <div class="flex w-full items-center gap-3">
          <span class="text-muted-foreground text-xs tabular-nums">
            {{ form.markedCount }} of {{ form.openDoses.length }} marked
          </span>
          <Button class="ms-auto" :disabled="form.pending || !form.canSave" @click="form.submit()">
            <Check class="size-4" /> Save pass
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
