<script setup>
// The reveal — one screen's outcome, hidden until somebody asks for it.
//
// This is a REAL boundary, not a curtain. The queue never carries outcomes at
// all, so revealing fetches GET /screens/:id: the browser is never sent a
// result nobody asked to see, and the audit log names exactly the screens
// somebody actually looked at. CLAUDE.md: "client-side hiding is presentation,
// never protection" — and the audit trail is the whole justification for techs
// seeing the Clinical group in the first place.
//
// It AUTO-COLLAPSES after 30 seconds, and when the tab is hidden. A phone put
// down face-up on a table is precisely the ambient disclosure module 13 warns
// about, and a reveal with no expiry becomes one within a minute.
import { Eye } from '@lucide/vue'
import { humanEnum, resultDisplay, toneClass } from '~/utils/screens.js'

const props = defineProps({
  screenId: { type: String, required: true },
  /** Rendered small on a record row, larger in a queue row. */
  compact: { type: Boolean, default: false },
})

const { getScreen } = useScreens()

const outcome = ref(null)
const loading = ref(false)
const error = ref('')
let timer = null

const REVEAL_MS = 30_000

function hide() {
  outcome.value = null
  clearTimeout(timer)
  timer = null
}

async function reveal() {
  if (outcome.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const screen = await getScreen(props.screenId)
    outcome.value = screen.outcome
    timer = setTimeout(hide, REVEAL_MS)
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not load this result.'
  } finally {
    loading.value = false
  }
}

function onVisibility() {
  if (document.visibilityState === 'hidden') hide()
}
onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onUnmounted(() => {
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisibility)
})

const cup = computed(() => (outcome.value ? resultDisplay(outcome.value.result) : null))
const lab = computed(() =>
  outcome.value?.labResult ? resultDisplay(outcome.value.labResult) : null,
)
</script>

<template>
  <!-- Sized like the chip that replaces it, so the row does not reflow — a
       jumping list is how a mis-tap reveals the wrong person's result. -->
  <button
    v-if="!outcome"
    type="button"
    class="text-muted-foreground hover:bg-accent/60 inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-0.5 text-[11px] transition-colors max-md:min-h-9 pointer-coarse:min-h-9"
    :disabled="loading"
    @click="reveal"
  >
    <Eye class="size-3" />
    {{ loading ? 'Loading…' : error || 'Show result' }}
  </button>

  <span v-else class="inline-flex flex-wrap items-center gap-1.5">
    <!-- A contradicted screen renders BOTH, never one: the facility has to be
         able to show it read a positive cup AND that the lab overturned it. -->
    <Badge
      variant="outline"
      class="border-transparent text-[10px]"
      :class="[toneClass(cup.tone), outcome.contradicted && 'line-through opacity-70']"
      :title="outcome.contradicted ? 'What the cup read' : undefined"
    >
      <template v-if="outcome.contradicted">Cup: </template>{{ cup.label }}
    </Badge>
    <span v-if="outcome.substances.length" class="text-muted-foreground text-[11px]">
      {{ outcome.substances.map(humanEnum).join(', ') }}
    </span>

    <template v-if="lab">
      <span class="text-muted-foreground text-[11px]">→</span>
      <Badge variant="outline" class="border-transparent text-[10px]" :class="toneClass(lab.tone)">
        Lab: {{ lab.label }}
      </Badge>
      <span v-if="outcome.labSubstances.length" class="text-muted-foreground text-[11px]">
        {{ outcome.labSubstances.map(humanEnum).join(', ') }}
      </span>
    </template>

    <button
      v-if="!compact"
      type="button"
      class="text-muted-foreground/70 hover:text-foreground text-[11px] underline underline-offset-2"
      @click="hide"
    >
      hide
    </button>
  </span>
</template>
