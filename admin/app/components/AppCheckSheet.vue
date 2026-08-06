<script setup>
// The DESKTOP shell for a check — a side drawer over the apartment cards,
// which on a desktop are themselves the picker, so a check is a detour from a
// page you keep in view.
//
// On the phone and the tablet the equivalent is /checks/round/[id], a
// full-screen step: a drawer over a picker on a 390px screen spends a third of
// the viewport on the thing you just left. Both shells render AppCheckForm and
// neither owns a rule — see that component's header.
import { Check } from '@lucide/vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  apartment: { type: Object, default: null },
  amendId: { type: String, default: null },
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
             occupies — the AppRollSheet lesson. -->
        <div class="flex items-start gap-2 pe-9">
          <SheetTitle class="min-w-0 flex-1 text-[15px]">
            {{ amendId ? `Amend check — ${form?.title ?? ''}` : `Check ${apartment?.name ?? ''}` }}
          </SheetTitle>
        </div>
        <p class="text-muted-foreground text-xs">
          <template v-if="amendId">The original stays; this files a corrected version.</template>
          <template v-else-if="form?.people?.length">
            <span class="tabular-nums">{{ form.people.length }}</span> to account for
          </template>
        </p>
      </SheetHeader>

      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AppCheckForm
          ref="form"
          :apartment="apartment"
          :amend-id="amendId"
          :active="open"
          @saved="onSaved"
        />
      </div>

      <SheetFooter v-if="form?.ready" class="border-t p-4">
        <div class="flex w-full items-center gap-3">
          <span class="text-muted-foreground text-xs tabular-nums">
            {{ form.accountedCount }} of {{ form.people.length }} accounted
          </span>
          <Button
            class="ms-auto"
            :disabled="form.pending || !form.canSave"
            @click="form.submit()"
          >
            <template v-if="amendId">File amendment</template>
            <template v-else><Check class="size-4" /> Save check</template>
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
