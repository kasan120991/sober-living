<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { Toaster as Sonner } from 'vue-sonner'
import { cn } from '@/lib/utils'

// LOAD-BEARING, and the whole reason toasts were invisible until 2026-08-08.
// vue-sonner 1.x injected its stylesheet from JS; 2.x ships it as a real file
// you must import — the identical migration FullCalendar 7 made, and the same
// failure shape: every toast reached the DOM, correctly positioned, with no
// rules to make it visible. Nothing throws and nothing warns, so the symptom is
// silence. It lives here rather than in nuxt.config's `css:` array so it cannot
// outlive the component that needs it; `shadcn-vue add sonner` would drop it.
import 'vue-sonner/style.css'

const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, 'class', 'toastOptions', 'theme')

// vue-sonner defaults `theme` to the literal string "light" — never "system" —
// so the toaster stamps data-sonner-theme="light" whatever the app is wearing.
// The `--normal-*` variables set in the template are theme-reactive and would
// have coped alone, but `rich-colors` is on, and rich colours are hardcoded per
// data-theme in sonner's own stylesheet: a success toast in dark mode came out
// near-white. Defaulted rather than forced, so a caller can still pin one.
const colorMode = useColorMode()
const theme = computed<ToasterProps['theme']>(
  () => props.theme ?? (colorMode.value === 'dark' ? 'dark' : 'light'),
)
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :theme="theme"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'hsl(var(--popover) / 0.9)',
      '--gray3': 'var(--border)',
      '--gray4': 'var(--border)',
      '--gray5': 'var(--border)',
      '--gray12': 'var(--popover-foreground)',
    }"
    :toast-options="props.toastOptions ?? {
      classes: {
        toast: 'rounded-2xl',
      },
    }"
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoIcon class="size-4" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="size-4" />
    </template>
    <template #error-icon>
      <OctagonXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>
