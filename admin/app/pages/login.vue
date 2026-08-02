<script setup>
// The one page outside the app shell.
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
  <div class="bg-muted/40 grid min-h-svh place-items-center p-5">
    <div class="bg-card w-full max-w-[380px] rounded-xl border p-7 shadow-sm">
      <div class="flex flex-col gap-5">
        <div class="flex items-center gap-2.5">
          <span class="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg">
            <span class="bg-primary-foreground size-2 rounded-[2px]" />
          </span>
          <span class="font-heading text-[15px] font-semibold tracking-tight">SoberLife</span>
        </div>

        <div>
          <h1 class="font-heading text-2xl font-semibold tracking-tight">Sign in</h1>
          <p class="text-muted-foreground mt-1 text-sm">Staff access to house operations.</p>
        </div>

        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <AppField v-slot="{ id }" label="Email">
            <Input
              :id="id"
              v-model="email"
              type="email"
              autocomplete="username"
              placeholder="you@facility.org"
              required
            />
          </AppField>

          <AppField v-slot="{ id }" label="Password">
            <Input
              :id="id"
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="••••••••••"
              required
            />
          </AppField>

          <Button type="submit" :disabled="pending" class="w-full">
            {{ pending ? 'Signing in…' : 'Sign in' }}
          </Button>
        </form>

        <!-- No "remember me": staff devices are shared, and a persistent
             session on a hallway phone is what session timeouts prevent. -->
        <p class="text-muted-foreground text-[11px] uppercase tracking-wider">
          Sessions end after 20 min idle
        </p>
      </div>
    </div>
  </div>
</template>
