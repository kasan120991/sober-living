<script setup>
// The staff app shell, shaped after shadcn's sidebar-08.
//
// `variant="inset"` is the visible part: the page ground becomes bg-sidebar,
// the sidebar floats in it, and the content pane is a rounded card. It also
// replaces SidebarRail — the rail is the collapse affordance for a sidebar
// flush against the window edge, and an inset one has no edge to grab. The
// trigger in the page header does that job.
import { BedDouble } from '@lucide/vue'

const { sections } = useNavigation()
const route = useRoute()

const isActive = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to))
</script>

<template>
  <SidebarProvider>
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" as-child>
              <NuxtLink to="/" aria-label="SoberLife — dashboard">
                <div
                  class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg"
                >
                  <BedDouble class="size-4" />
                </div>
                <div class="grid flex-1 text-left text-sm leading-tight">
                  <span class="font-heading truncate font-semibold">SoberLife</span>
                  <!-- Second line names which app this is. There are two against
                       one API and they must never be confused for each other.
                       Becomes the facility name once facility config exists. -->
                  <span class="truncate text-xs">Staff</span>
                </div>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup v-for="group in sections.main" :key="group.id">
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

        <!-- mt-auto pins this to the bottom of the scroll area, so admin links
             sit apart from the work without being a separate labelled group. -->
        <SidebarGroup v-if="sections.secondary.length" class="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in sections.secondary" :key="item.to">
                <SidebarMenuButton
                  as-child
                  size="sm"
                  :is-active="isActive(item.to)"
                  :tooltip="item.label"
                >
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
    </Sidebar>

    <SidebarInset>
      <slot />
    </SidebarInset>
  </SidebarProvider>
</template>
