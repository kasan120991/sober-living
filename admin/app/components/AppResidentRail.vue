<script setup>
// The resident record's section rail.
//
// It is navigation that doubles as a status board: a section can carry a dot, so
// where attention is needed reads before anything is opened. A section with
// nothing wrong carries no dot — the same rule the census tiles follow, where
// absence of a chip means present. It is what keeps a quiet record quiet.
//
// This is in-page navigation, not app navigation. It is not the second-level
// sidebar menu rejected under UI rules: these sections are real and already
// named, not IA invented to fill a template's shape.
//
// Below md the rail collapses to a sheet, because 208px of nav beside the app's
// densest tables is not a phone layout. The trigger keeps the dots visible so
// the status board survives the collapse.
import { ChevronDown } from '@lucide/vue'
import { RESIDENT_GROUPS, sectionsInGroup, SECTION_DOT } from '~/utils/residentSections.js'

const props = defineProps({
  /** The active section key. */
  modelValue: { type: String, required: true },
  /** `{ [sectionKey]: count }` — omitted keys simply show no count. */
  counts: { type: Object, default: () => ({}) },
  /** `{ [sectionKey]: 'warning' | 'critical' }` from `sectionDots()`. */
  dots: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue'])

const sheetOpen = ref(false)

const current = computed(() =>
  RESIDENT_GROUPS.flatMap(sectionsInGroup).find((s) => s.key === props.modelValue),
)

// Shown on the sheet trigger so the phone still gets the status board. Ordered
// so critical reads first when both are present.
const triggerDots = computed(() => {
  const values = Object.values(props.dots)
  return [
    ...values.filter((d) => d === SECTION_DOT.CRITICAL),
    ...values.filter((d) => d === SECTION_DOT.WARNING),
  ]
})

function choose(key) {
  emit('update:modelValue', key)
  sheetOpen.value = false
}

const dotClass = (d) =>
  d === SECTION_DOT.CRITICAL ? 'bg-destructive' : d === SECTION_DOT.WARNING ? 'bg-warning' : ''
</script>

<template>
  <div class="md:sticky md:top-4 md:w-52 md:shrink-0">
    <!-- Phone: the rail becomes a sheet, and the trigger names where you are. -->
    <div class="md:hidden">
      <button
        type="button"
        class="bg-card hover:bg-accent flex h-11 w-full items-center justify-between gap-3 rounded-md border px-3 text-left text-sm font-medium transition-colors"
        @click="sheetOpen = true"
      >
        <span class="truncate">{{ current?.label ?? 'Section' }}</span>
        <span class="flex shrink-0 items-center gap-1.5">
          <span
            v-for="(d, i) in triggerDots"
            :key="i"
            class="size-1.5 rounded-full"
            :class="dotClass(d)"
          />
          <ChevronDown class="text-muted-foreground size-4" aria-hidden="true" />
        </span>
      </button>

      <Sheet v-model:open="sheetOpen">
        <SheetContent side="left" class="w-72 p-0">
          <SheetHeader class="border-b p-4">
            <SheetTitle class="text-[15px]">Record sections</SheetTitle>
          </SheetHeader>
          <nav class="flex flex-col gap-0.5 overflow-y-auto p-2">
            <template v-for="group in RESIDENT_GROUPS" :key="group">
              <p
                class="text-muted-foreground px-2 pt-3 pb-1 text-[10.5px] font-semibold tracking-wider uppercase"
              >
                {{ group }}
              </p>
              <button
                v-for="s in sectionsInGroup(group)"
                :key="s.key"
                type="button"
                class="hover:bg-accent flex h-11 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors"
                :class="[
                  s.key === modelValue ? 'bg-accent font-medium' : 'text-muted-foreground',
                  !s.built && s.key !== modelValue && 'opacity-60',
                ]"
                :aria-current="s.key === modelValue ? 'true' : undefined"
                @click="choose(s.key)"
              >
                <span
                  v-if="dots[s.key]"
                  class="size-1.5 shrink-0 rounded-full"
                  :class="dotClass(dots[s.key])"
                />
                <span class="truncate">{{ s.label }}</span>
                <span v-if="counts[s.key]" class="text-muted-foreground ms-auto text-xs tabular-nums">
                  {{ counts[s.key] }}
                </span>
              </button>
            </template>
          </nav>
        </SheetContent>
      </Sheet>
    </div>

    <!-- Desktop: the rail proper. -->
    <div class="hidden md:flex md:flex-col md:gap-3">
      <div v-if="$slots.summary" class="bg-card flex flex-col gap-2 rounded-md border p-3">
        <slot name="summary" />
      </div>

      <nav class="flex flex-col gap-0.5">
        <template v-for="group in RESIDENT_GROUPS" :key="group">
          <p
            class="text-muted-foreground px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider uppercase"
          >
            {{ group }}
          </p>
          <button
            v-for="s in sectionsInGroup(group)"
            :key="s.key"
            type="button"
            class="hover:bg-accent flex h-9 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors pointer-coarse:h-11"
            :class="[
              s.key === modelValue ? 'bg-accent font-medium' : 'text-muted-foreground',
              !s.built && s.key !== modelValue && 'opacity-60',
            ]"
            :aria-current="s.key === modelValue ? 'true' : undefined"
            @click="choose(s.key)"
          >
            <span
              v-if="dots[s.key]"
              class="size-1.5 shrink-0 rounded-full"
              :class="dotClass(dots[s.key])"
            />
            <span class="truncate">{{ s.label }}</span>
            <span v-if="counts[s.key]" class="text-muted-foreground ms-auto text-xs tabular-nums">
              {{ counts[s.key] }}
            </span>
          </button>
        </template>
      </nav>
    </div>
  </div>
</template>
