<script setup>
// The schedule board's toolbar — pulse's own, ported to Vue.
//
// FullCalendar publishes this layout as part of the shadcn `pulse` flavour, but
// the registry ships React `.tsx` only (all ten of its items do), so this is a
// hand port. It is a faithful one: same structure, same order, same button
// variants — Today, then prev/next, then the title, then the view switch.
//
// Two things it buys over the hand-rolled button group it replaces:
//
//   - The view switch is the vendored `Tabs`, so it gets roving focus, arrow
//     keys and aria-selected for free. The old group had none of that.
//   - prev/next DISABLE at a navigable range's edge, which the old group could
//     not know about. That comes from controller.getButtonState().
//
// ── How the controller works, and the one trap in it ───────────────────────
// `useCalendarController()` returns a Proxy over a revision ref, so simply
// READING any property inside a template or computed subscribes to it — which is
// why `controller.view?.title` updates on navigation with no watcher.
//
// The trap: getButtonState() proxies an EMPTY object, resolving each key on
// access. So it must be INDEXED (`buttons.prev.isDisabled`) and never
// key-iterated — Object.keys() on it returns [] and a v-for over it renders
// nothing. That is why VIEWS below is our own list rather than something read
// off the button state.
import { ChevronLeft, ChevronRight } from '@lucide/vue'

const props = defineProps({
  /** From useCalendarController() in the parent that owns the calendar. */
  controller: { type: Object, required: true },
  /** `[{ key, label }]` — FullCalendar view names in display order. */
  views: { type: Array, required: true },
})

// Our own labels, not buttons[view].text: FullCalendar's locale strings are
// lowercase ("day", "week"), and the app capitalises its controls.
const active = computed({
  get: () => props.controller.view?.type ?? props.views[0]?.key,
  set: (key) => props.controller.changeView(key),
})

const buttons = computed(() => props.controller.getButtonState())
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex shrink-0 items-center gap-2">
      <!-- The hint goes in `title`, NOT aria-label — a deliberate divergence from
           the React block, which binds aria-label to it. FullCalendar's hint is
           view-dependent ("This Month" in month view), so as an aria-label it
           REPLACES the visible word "Today" with text that does not contain it:
           a WCAG 2.5.3 Label-in-Name failure, and a screen reader would announce
           a button the user cannot refer to by what they see. -->
      <Button variant="outline" size="sm" :title="buttons.today?.hint" @click="controller.today()">
        Today
      </Button>

      <div class="flex items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="buttons.prev?.isDisabled"
          :aria-label="buttons.prev?.hint ?? 'Previous'"
          @click="controller.prev()"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="buttons.next?.isDisabled"
          :aria-label="buttons.next?.hint ?? 'Next'"
          @click="controller.next()"
        >
          <ChevronRight />
        </Button>
      </div>

      <!-- The calendar's own title, so the label can never disagree with what
           is drawn below it — the failure the page's hand-computed label had. -->
      <p class="text-[15px] font-semibold">{{ controller.view?.title }}</p>
    </div>

    <Tabs v-model="active">
      <TabsList>
        <TabsTrigger v-for="v in views" :key="v.key" :value="v.key">{{ v.label }}</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>
</template>
