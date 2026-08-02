<script setup>
// The bell, in the app header on every page.
//
// It shows situations, not messages: everything in it is derived from current
// state on the server, so an item disappears when the situation is resolved
// rather than when somebody dismisses it. That is why there is no "mark as
// read" — there is nothing to mark.
import { BedSingle, Bell, Wrench, CircleAlert } from '@lucide/vue'

const { items, actionCount, refresh } = useNotifications()
const route = useRoute()
const open = ref(false)

await refresh()
// Navigation is the cheap, reliable moment to re-check. No polling timer.
watch(() => route.fullPath, refresh)
watch(open, (isOpen) => isOpen && refresh())

const ICONS = {
  UNHOUSED: BedSingle,
  URGENT_MAINTENANCE: Wrench,
  BED_OUT_OF_SERVICE: CircleAlert,
}

const label = computed(() =>
  actionCount.value
    ? `Notifications — ${actionCount.value} needing attention`
    : 'Notifications — nothing needs attention',
)
</script>

<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" class="relative" :aria-label="label">
        <Bell class="size-4" />
        <!-- The count is on the icon rather than beside it so the control stays
             a fixed size and the header does not shift when the number changes. -->
        <span
          v-if="actionCount"
          class="bg-warning text-warning-foreground absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums"
        >
          {{ actionCount > 9 ? '9+' : actionCount }}
        </span>
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" :side-offset="8" class="w-[min(22rem,calc(100vw-2rem))] p-0">
      <div class="flex items-center justify-between gap-2 px-3 py-2.5">
        <span class="text-[13.5px] font-medium">Notifications</span>
        <span class="text-muted-foreground text-xs tabular-nums">{{ actionCount }}</span>
      </div>
      <DropdownMenuSeparator class="my-0" />

      <div class="max-h-[min(24rem,60vh)] overflow-y-auto">
        <DropdownMenuItem
          v-for="n in items"
          :key="n.id"
          as-child
          class="cursor-pointer items-start gap-2.5 px-3 py-2.5"
        >
          <NuxtLink :to="n.to">
            <component
              :is="ICONS[n.kind] ?? CircleAlert"
              class="mt-0.5 size-4 shrink-0"
              :class="n.level === 'action' ? 'text-warning' : 'text-muted-foreground'"
              aria-hidden="true"
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-[13px] leading-snug font-medium">{{ n.title }}</span>
              <span class="text-muted-foreground text-xs leading-snug">{{ n.detail }}</span>
            </span>
          </NuxtLink>
        </DropdownMenuItem>

        <!-- A quiet house is the good outcome, so say so plainly rather than
             showing an empty box. -->
        <p v-if="!items.length" class="text-muted-foreground px-3 py-8 text-center text-sm">
          Nothing needs attention.
        </p>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
