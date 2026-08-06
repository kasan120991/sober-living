<script setup>
// Hours against a target, with the pace marker.
//
// Chosen from three rendered variants (2026-08-05). The marker is the whole
// point: the gap between where the bar ends and where the marker sits IS the
// deficit, so "behind by two hours" is read spatially rather than computed. A
// plain total cannot say whether a number is enough BY NOW, which is the only
// question the amber dot is answering.
//
// Built on AppCohortCapacity's idiom — an h-2 track with flex children sized by
// :style="{ flex: n }" — rather than shadcn's Progress, which is a single value
// and cannot carry two segments plus a marker. Adding it would also trigger the
// main.css / Google-Fonts-CDN rewrite CLAUDE.md warns about, for nothing.
import { hours, paceSentence, progressOf } from '~/utils/serviceHours.js'

const props = defineProps({
  /**
   * `current.service` from GET /residents/:id, or a row from GET /service —
   * both carry the same minute-denominated keys.
   */
  service: { type: Object, default: null },
  /**
   * Bar only, for a table row. The figures and the sentence live in the row's
   * own cells there, and repeating them would make the column unreadable.
   * The bar and its marker stay in this one component either way, so the two
   * densities cannot drift apart.
   */
  compact: { type: Boolean, default: false },
})

const bars = computed(() => progressOf(props.service))
const label = computed(
  () =>
    `${hours(props.service?.verifiedMinutes)} verified of ${hours(props.service?.requiredMinutes)}`,
)
</script>

<template>
  <div v-if="bars" class="flex flex-col gap-2">
    <div v-if="!compact" class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span class="text-xl leading-none font-semibold tabular-nums">
        {{ hours(service.verifiedMinutes) }}
      </span>
      <span class="text-muted-foreground text-sm">of {{ hours(service.requiredMinutes) }}</span>
      <Badge
        v-if="service.behind"
        variant="outline"
        class="border-warning/45 bg-warning/15 text-warning"
      >
        Behind {{ hours(service.behindMinutes) }}
      </Badge>
      <span v-if="service.pendingMinutes" class="text-muted-foreground ms-auto text-xs">
        {{ hours(service.pendingMinutes) }} awaiting a signature
      </span>
    </div>

    <!-- pt-4 leaves room for the marker's caption, which sits above the track.
         A compact bar has no caption, so it needs no headroom. -->
    <div class="relative" :class="compact ? 'py-1' : 'pt-4'">
      <span
        v-if="bars.pacePercent !== null && !compact"
        class="absolute top-0 -translate-x-1/2 text-[9.5px] font-semibold tracking-wider whitespace-nowrap uppercase"
        :class="service.behind ? 'text-warning' : 'text-muted-foreground'"
        :style="{ left: `${bars.pacePercent}%` }"
      >
        Due by now
      </span>

      <div
        class="bg-muted flex gap-0.5 overflow-hidden rounded-[3px]"
        :class="compact ? 'h-1.5' : 'h-2.5'"
        role="progressbar"
        :aria-valuenow="Math.round(service.verifiedMinutes / 60)"
        :aria-valuemin="0"
        :aria-valuemax="Math.round(service.requiredMinutes / 60)"
        :aria-label="label"
      >
        <span v-if="bars.verified" class="bg-primary block h-full" :style="{ flex: bars.verified }" />
        <!-- Hatched, reusing the treatment AppCohortCapacity gives an
             out-of-service bed. In this app hatching already means "present but
             not counted", which is exactly what an unverified hour is. -->
        <span
          v-if="bars.pending"
          class="block h-full"
          :style="{
            flex: bars.pending,
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--primary) 0 3px, transparent 3px 6px)',
          }"
        />
        <span v-if="bars.remaining" :style="{ flex: bars.remaining }" />
      </div>

      <span
        v-if="bars.pacePercent !== null"
        class="absolute -top-0.5 bottom-[-3px] w-0.5 rounded-full"
        :class="service.behind ? 'bg-warning' : 'bg-muted-foreground/60'"
        :style="{ left: `${bars.pacePercent}%` }"
        aria-hidden="true"
      />
    </div>

    <!-- Variant B's contribution: the marker is legible but has to be learned
         once, and this means it never has to be. -->
    <p v-if="!compact" class="text-muted-foreground text-xs">
      {{ paceSentence(service) }}
      <template v-if="service.targetSource === 'PROGRAM'"> Phase default.</template>
      <template v-else-if="service.targetSource === 'STAY'"> Set for this stay.</template>
    </p>
  </div>

  <!-- No target means no bar and no dot — absence of a signal means fine, the
       same rule the census tiles and the rail follow. -->
  <p v-else-if="!compact" class="text-muted-foreground text-sm">
    No target set for this stay.
    <template v-if="service && service.pendingMinutes">
      {{ hours(service.pendingMinutes) }} logged and awaiting a signature.
    </template>
  </p>
  <span v-else class="text-muted-foreground text-xs">—</span>
</template>
