<script setup>
// The staff app shell, on shadcn-vue's Sidebar.
//
// Three Nuxt UI workarounds disappear with this:
//   - collapse state persists in a `sidebar_state` cookie by default, so the
//     explicit id="main" fix for Nuxt UI's useId() key bug is gone
//   - the mobile pane is a Sheet with a real title, so the `menu` prop patch
//     for a missing locale key is gone
//   - 44px targets are baked into the vendored component source instead of
//     being fought through app.config.ts slot overrides
import { Home } from '@lucide/vue'

const { itemsFor } = useNavigation()
const route = useRoute()

// Flat list; the group headings come from the group objects themselves.
const groups = computed(() => itemsFor(false))
const isActive = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to))
</script>

<template>
  <SidebarProvider>
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" as-child>
              <NuxtLink to="/" aria-label="SoberLife — census">
                <div
                  class="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg"
                >
                  <Home class="size-4" />
                </div>
                <div class="grid flex-1 text-left leading-tight">
                  <span class="font-heading truncate font-semibold">SoberLife</span>
                </div>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup v-for="(group, i) in groups" :key="i">
          <SidebarGroupLabel v-if="group.label">{{ group.label }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in group.items" :key="item.to">
                <!-- `tooltip` is what surfaces the label once collapsed to the
                     icon rail; shadcn renders it as a Tooltip automatically. -->
                <SidebarMenuButton as-child :is-active="isActive(item.to)" :tooltip="item.label">
                  <NuxtLink :to="item.to">
                    <component :is="item.icon" class="size-4" />
                    <span>{{ item.label }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <AppUserMenu />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>

    <SidebarInset>
      <slot />
    </SidebarInset>
  </SidebarProvider>
</template>
