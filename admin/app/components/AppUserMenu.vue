<script setup>
import { ChevronsUpDown, LogOut, UserRound } from '@lucide/vue'
import { initialsOf, roleLabel } from '~/utils/roles.js'
// Composables exported from a component barrel are not auto-imported — Nuxt
// only scans composables/ and utils/.
import { useSidebar } from '~/components/ui/sidebar'

const { user, signOut } = useAuth()
// `state` is 'expanded' | 'collapsed'; in the icon rail we show the avatar
// alone and let the dropdown carry the identity.
const { state, isMobile } = useSidebar()
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent"
            :aria-label="`Signed in as ${user?.fullName}. Open account menu`"
          >
            <Avatar class="size-8 rounded-lg">
              <AvatarFallback class="rounded-lg">{{ initialsOf(user?.fullName) }}</AvatarFallback>
            </Avatar>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-medium">{{ user?.fullName }}</span>
              <span class="text-muted-foreground truncate text-xs">
                {{ roleLabel(user?.role) }}
              </span>
            </div>
            <ChevronsUpDown class="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          class="w-56 rounded-lg"
          :side="isMobile ? 'bottom' : state === 'collapsed' ? 'right' : 'top'"
          align="end"
          :side-offset="8"
        >
          <!-- Identity is stated, not decorative: on a shared house phone this
               is the name that gets stamped on the next med pass or screen. -->
          <DropdownMenuLabel class="p-0 font-normal">
            <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar class="size-8 rounded-lg">
                <AvatarFallback class="rounded-lg">{{ initialsOf(user?.fullName) }}</AvatarFallback>
              </Avatar>
              <div class="grid flex-1 leading-tight">
                <span class="truncate font-medium">{{ user?.fullName }}</span>
                <span class="text-muted-foreground truncate text-xs">
                  {{ roleLabel(user?.role) }}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem as-child>
            <NuxtLink to="/account">
              <UserRound class="size-4" />
              Account
            </NuxtLink>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="signOut">
            <LogOut class="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
