<script setup>
import { initialsOf, roleLabel } from '~/utils/roles.js'

// `collapsed` comes from UDashboardSidebar's slot props — when railed we show
// the avatar alone and let the dropdown carry the identity.
const props = defineProps({
  collapsed: { type: Boolean, default: false },
})

const { user, signOut } = useAuth()

const items = computed(() => [
  [
    {
      // Non-interactive identity header. On a shared house phone this is the
      // name that gets stamped on the next med pass or screen result, so it is
      // stated plainly rather than left to memory.
      //
      // The avatar is what puts this row's text in the same column as the
      // labels below — without a leading element the name sits flush left while
      // every item under it is indented past its icon.
      type: 'label',
      label: user.value?.fullName ?? '—',
      description: roleLabel(user.value?.role),
      avatar: {
        alt: user.value?.fullName,
        text: initialsOf(user.value?.fullName),
        // size-5 matches the 20px icons on the items below, so the avatar
        // occupies exactly the same leading column and the text lines up.
        ui: {
          root: 'size-5 shrink-0 bg-[var(--color-ink)]',
          fallback: 'text-[9px] leading-none text-white font-medium',
        },
      },
    },
  ],
  [{ label: 'Account', icon: 'i-lucide-user-round', to: '/account' }],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => signOut() }],
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: props.collapsed ? 'center' : 'start', side: 'top', sideOffset: 8 }"
    :ui="{ content: 'w-56' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      block
      :square="props.collapsed"
      class="min-h-11"
      :aria-label="`Signed in as ${user?.fullName}. Open account menu`"
      :ui="{ base: props.collapsed ? 'justify-center px-0' : 'justify-start' }"
    >
      <UAvatar
        :alt="user?.fullName"
        :text="initialsOf(user?.fullName)"
        size="xs"
        :ui="{ root: 'bg-[var(--color-ink)]', fallback: 'text-white font-medium' }"
      />

      <span v-if="!props.collapsed" class="flex min-w-0 flex-col items-start leading-tight">
        <span class="truncate text-[13px] font-medium text-[var(--color-ink)]">
          {{ user?.fullName }}
        </span>
        <span class="truncate text-[11px] text-[var(--color-mute)]">
          {{ roleLabel(user?.role) }}
        </span>
      </span>

      <UIcon
        v-if="!props.collapsed"
        name="i-lucide-chevrons-up-down"
        class="ms-auto size-4 shrink-0 text-[var(--color-faint)]"
        aria-hidden="true"
      />
    </UButton>
  </UDropdownMenu>
</template>
