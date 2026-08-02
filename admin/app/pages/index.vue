<script setup>
const { user, signOut } = useAuth()
</script>

<template>
  <div class="min-h-screen p-6 lg:p-8">
    <div class="mx-auto max-w-3xl flex flex-col gap-6">
      <div class="flex items-start justify-between">
        <div>
          <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-mute)]">
            Signed in
          </p>
          <h1 class="text-[28px] font-semibold tracking-[-0.028em] text-[var(--color-ink)]">
            {{ user?.fullName }}
          </h1>
          <p class="text-sm text-[var(--color-mute)]">{{ user?.role }}</p>
        </div>
        <UButton color="neutral" variant="outline" @click="signOut">Sign out</UButton>
      </div>

      <div class="rounded-[var(--ui-radius)] border border-[var(--color-hairline)] bg-[var(--color-elevated)] p-5">
        <p class="text-sm">
          Placeholder home. The census board lands here — see CLAUDE.md module 2.
        </p>
      </div>
    </div>
  </div>
</template>
