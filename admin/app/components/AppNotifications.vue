<script setup>
// The bell, in the app header on every page.
//
// IT SHOWS EVENTS — what just happened — since 2026-08-09. It used to show
// derived SITUATIONS, and the reason that changed is that the situations found
// better homes: the dashboard's Needs attention panel and the sidebar count
// badges both carry them now, and both clear themselves. Repeating them here
// was the third copy of the same list.
//
// So the bell is free to be the thing a derived item can never be: a record of
// what happened, which persists past the moment, can be unread, and can be
// toasted. That is a deliberate reversal of module 12's "there is no
// Notification table" — see CLAUDE.md for the four conditions it named for its
// own reversal and how each is met.
//
// WHAT IS LOST, plainly: a derived item cannot go stale or be dismissed into a
// lie, and an event can. A "not found on the round" event stands even after an
// amendment corrects it — because it did happen, and somebody was told. The
// SITUATION clears itself everywhere else, which is what makes that acceptable.
import { Bell, BellOff, CircleAlert, CircleDollarSign, Inbox } from '@lucide/vue'
import {
  facilityDateNow,
  facilityDateOf,
  formatFacilityTime,
  humanDate,
} from '~/utils/facilityTime.js'

const { events, unseenCount, refresh, markSeen } = useNotifications()
const route = useRoute()
const open = ref(false)

await refresh()
// Navigation is the cheap, reliable moment to re-check. No polling timer — the
// realtime socket covers everything between navigations.
watch(() => route.fullPath, refresh)
// Opening the panel refreshes, then marks read: you have now seen them, and the
// badge should not still be claiming otherwise when the panel is in front of
// you. markSeen is per-user and broadcasts nothing.
watch(open, async (isOpen) => {
  if (!isOpen) return
  await refresh()
  await markSeen()
})

const ICONS = {
  REQUEST: Inbox,
  MONEY: CircleDollarSign,
  SAFETY: CircleAlert,
}

// Safety is the only class that gets the loud colour. A request and a payment
// are things to do, not things that are wrong — the same restraint the
// attention panel's single amber dot exists for.
const toneOf = (c) => (c === 'SAFETY' ? 'text-destructive' : 'text-muted-foreground')

const label = computed(() =>
  unseenCount.value
    ? `Notifications — ${unseenCount.value} unread`
    : 'Notifications — nothing unread',
)

/** "2:14 PM" today, "Thu, Aug 7" before that. A feed is read by recency. */
function when(at) {
  const d = facilityDateOf(at)
  return d === facilityDateNow() ? formatFacilityTime(at) : humanDate(d, { short: true })
}
</script>

<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" class="relative" :aria-label="label">
        <Bell class="size-4" />
        <!-- The count is on the icon rather than beside it so the control stays
             a fixed size and the header does not shift when the number changes.
             It counts UNREAD EVENTS now, not open situations — those are the
             sidebar's badges and the dashboard's panels. -->
        <span
          v-if="unseenCount"
          class="bg-warning text-warning-foreground absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums"
        >
          {{ unseenCount > 9 ? '9+' : unseenCount }}
        </span>
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" :side-offset="8" class="w-[min(23rem,calc(100vw-2rem))] p-0">
      <div class="flex items-center justify-between gap-2 px-3 py-2.5">
        <span class="text-[13.5px] font-medium">Activity</span>
        <span v-if="unseenCount" class="text-muted-foreground text-xs tabular-nums">
          {{ unseenCount }} new
        </span>
      </div>
      <DropdownMenuSeparator class="my-0" />

      <div class="max-h-[min(24rem,60vh)] overflow-y-auto">
        <DropdownMenuItem
          v-for="n in events"
          :key="n.id"
          as-child
          class="cursor-pointer items-start gap-2.5 px-3 py-2.5"
        >
          <NuxtLink :to="n.to">
            <component
              :is="ICONS[n.class] ?? CircleAlert"
              class="mt-0.5 size-4 shrink-0"
              :class="toneOf(n.class)"
              aria-hidden="true"
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-[13px] leading-snug font-medium">{{ n.title }}</span>
              <span class="text-muted-foreground text-xs leading-snug">
                <template v-if="n.detail">{{ n.detail }} · </template>{{ when(n.at) }}
              </span>
            </span>
          </NuxtLink>
        </DropdownMenuItem>

        <!-- A quiet feed is the ordinary outcome, so say so plainly. Note this
             does NOT mean nothing needs attention — that question moved to the
             dashboard and the sidebar badges. -->
        <p
          v-if="!events.length"
          class="text-muted-foreground flex flex-col items-center gap-2 px-3 py-8 text-center text-sm"
        >
          <BellOff class="size-5" aria-hidden="true" />
          Nothing has happened recently.
        </p>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
