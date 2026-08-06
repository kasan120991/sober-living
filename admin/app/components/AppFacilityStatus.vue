<script setup>
// One figure, never three.
//
// A bar carrying beds-free, unplaced and overdue side by side is a dashboard,
// and the moment two of them are non-zero it competes with the bell for the
// same attention. The server picks the single most urgent true thing and falls
// back to capacity when the house is quiet — see services/facilityStatus.js.
//
// Counts only, no names, which is what makes it safe to render on every screen
// regardless of who is standing behind the phone. The bell is where detail
// lives, because opening it is a deliberate act.
const { status, refresh } = useFacilityStatus()
const route = useRoute()

await refresh()
watch(() => route.fullPath, refresh)

const tone = computed(() => {
  switch (status.value?.level) {
    case 'critical':
      return { pip: 'bg-destructive', text: 'text-destructive' }
    case 'warning':
      return { pip: 'bg-warning', text: 'text-warning' }
    default:
      return { pip: 'bg-muted-foreground', text: 'text-foreground' }
  }
})
</script>

<template>
  <!-- Hidden on the narrowest screens: at 375px the bar is the trigger, the
       search icon and the bell, and a fourth item pushes one of them off. -->
  <NuxtLink
    v-if="status"
    to="/"
    class="text-muted-foreground hover:bg-muted hidden shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-[12.5px] whitespace-nowrap transition-colors sm:flex"
    :aria-label="`${status.count} ${status.label} — open the dashboard`"
  >
    <span class="size-1.5 rounded-full" :class="tone.pip" aria-hidden="true" />
    <span><span class="font-semibold tabular-nums" :class="tone.text">{{ status.count }}</span>
      {{ status.label }}</span>
  </NuxtLink>
</template>
