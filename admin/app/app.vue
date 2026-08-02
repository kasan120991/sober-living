<script setup>
// Explicit because this is the one vendored component whose file name
// (Sonner.vue) differs from its export, so Nuxt's file-based auto-import
// would look for <Sonner /> instead.
import { Toaster } from '~/components/ui/sonner'
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- Replaces UApp. Sonner renders toasts; useToast() is gone. -->
  <Toaster rich-colors close-button />
</template>
