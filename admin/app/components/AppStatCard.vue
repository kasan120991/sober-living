<script setup>
// One figure on the dashboard's status strip.
//
// Extracted from three inline copies in pages/index.vue, each ~25 lines of the
// same class string. Three was tolerable; a fourth was not, and a fourth is
// what the hourly round needs.
//
// EVERY CARD IS A LINK, and that is the rule rather than a convenience: a card
// that names a number should take you where you act on it (CLAUDE.md module 14,
// 2026-08-06). The destination is a prop with no default, so a caller cannot
// forget to answer the question.
//
// The sub-line is a SLOT, not a string prop. Every one of them carries markup —
// a destructive span for the overdue part, tabular-nums on a figure inside the
// sentence — and a prop would either lose that or invite v-html.
const props = defineProps({
  to: { type: String, required: true },
  /**
   * A Lucide component, not a name.
   *
   * `[Object, Function]`, and the Function half is load-bearing: Lucide's Vue
   * icons are FUNCTIONAL components, so typing this `Object` alone made all
   * four cards warn "Expected Object, got Function" on every render. That noise
   * is not cosmetic — it drowned the "Missing required prop" warning that was
   * the only signal a card had been given an icon nobody imported, which is
   * exactly how the hourly-round card shipped with no icon at all. A prop type
   * that cries wolf costs more than no prop type.
   */
  icon: { type: [Object, Function], required: true },
  /** Pre-formatted: money() has already run, so this component does no maths. */
  figure: { type: [String, Number], required: true },
  /**
   * `destructive` tints the icon tile when the figure itself is the alarm.
   * Deliberately NOT an inset — this page carries exactly one, and it is spent
   * on the unaccounted band.
   */
  tone: { type: String, default: 'default' },
})

const NuxtLink = resolveComponent('NuxtLink')

const tile = computed(() =>
  props.tone === 'destructive'
    ? 'bg-destructive/10 text-destructive'
    : 'bg-primary/10 text-primary',
)
</script>

<template>
  <!-- The border warms to primary on hover rather than the card lifting, which
       is the preset's own idiom. The whole tile is the link — `as` takes the
       component, so there is no wrapper element between Card and NuxtLink. -->
  <Card
    :as="NuxtLink"
    :to="to"
    class="hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-ring/30
      flex-row items-center gap-3.5 outline-none transition-colors focus-visible:ring-3"
  >
    <div class="flex size-10 shrink-0 items-center justify-center rounded-lg" :class="tile">
      <component :is="icon" class="size-5" />
    </div>
    <div class="min-w-0">
      <p class="text-2xl leading-tight font-semibold tracking-tight tabular-nums">{{ figure }}</p>
      <p class="text-muted-foreground text-xs"><slot name="qualifier" /></p>
    </div>
  </Card>
</template>
