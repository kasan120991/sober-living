<script setup>
/**
 * Label + description + error around a form control.
 *
 * Replaces Nuxt UI's UFormField, which was used purely for this layout. We
 * deliberately do NOT adopt shadcn-vue's Form: it is vee-validate based, and
 * this app validates server-side with zod — adding a second validation stack to
 * get a label is the wrong trade.
 */
import { useId } from 'vue'

defineProps({
  label: { type: String, default: '' },
  description: { type: String, default: '' },
  error: { type: String, default: '' },
  required: { type: Boolean, default: false },
})

// Generated here so the label points at the control without every caller
// inventing an id.
const id = useId()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label v-if="label" :for="id" class="text-sm font-medium">
      {{ label }}
      <span v-if="required" class="text-destructive" aria-hidden="true">*</span>
    </Label>

    <slot :id="id" />

    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
    <p v-else-if="description" class="text-muted-foreground text-xs">{{ description }}</p>
  </div>
</template>
