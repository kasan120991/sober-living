<script setup>
// Variant A (centered card). The one page outside the app shell.
definePageMeta({ layout: false })

const { signIn } = useAuth()

const email = ref('')
const password = ref('')
const error = ref('')
const pending = ref(false)

async function onSubmit() {
  error.value = ''
  pending.value = true
  try {
    await signIn(email.value, password.value)
    await navigateTo('/')
  } catch (err) {
    // Always the server's single generic message. Never distinguish "no such
    // account" from "wrong password" — see server/src/routes/auth.js.
    error.value = err?.data?.error ?? "That email and password don't match."
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="min-h-screen grid place-items-center bg-[var(--color-canvas)] p-5">
    <div
      class="w-full max-w-[372px] rounded-[10px] border border-[var(--color-hairline)] bg-[var(--color-elevated)] p-7 flex flex-col gap-[22px]"
    >
      <div class="flex flex-col gap-[18px]">
        <div class="flex items-center gap-[9px]">
          <span class="grid size-[22px] place-items-center rounded-[5px] bg-[var(--color-ink)]">
            <span class="size-2 rounded-[2px] bg-[var(--color-elevated)]" />
          </span>
          <span class="text-[14.5px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">
            SoberLife
          </span>
        </div>
        <div>
          <h1 class="text-[22px] font-semibold tracking-[-0.028em] text-[var(--color-ink)]">
            Sign in
          </h1>
          <p class="mt-1.5 text-[13.5px] text-[var(--color-mute)]">
            Staff access to house operations.
          </p>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        :description="error"
      />

      <form class="flex flex-col gap-[15px]" @submit.prevent="onSubmit">
        <UFormField label="Email" name="email">
          <UInput
            v-model="email"
            type="email"
            autocomplete="username"
            placeholder="you@facility.org"
            size="xl"
            class="w-full"
            required
          />
        </UFormField>

        <UFormField label="Password" name="password">
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••••"
            size="xl"
            class="w-full"
            required
          />
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          size="xl"
          block
          :loading="pending"
          :label="pending ? 'Signing in…' : 'Sign in'"
        />
      </form>

      <div class="flex items-center justify-between pt-1">
        <!-- No 'remember me': staff devices are shared, and a persistent
             session on a hallway phone is what session timeouts prevent. -->
        <span class="font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--color-faint)]">
          Sessions end after 20 min idle
        </span>
      </div>
    </div>
  </div>
</template>
