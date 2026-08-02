<script setup>
// The staff app shell. Composed from Nuxt UI's dashboard components rather than
// hand-built — they already handle focus management, the mobile slideover, the
// resize handle and state persistence.
const { itemsFor } = useNavigation()
</script>

<template>
  <!--
    unit="rem" so `collapsedSize` can be a fixed rail width. The default is "%",
    which would make the collapsed rail scale with the viewport.

    The sidebar's `id` must be set explicitly. Its persistence key is
    `${storageKey}-sidebar-${id || useId()}`, and useId() returns a different
    value on every render — without a fixed id the sidebar writes a new cookie
    each time and never reads its own state back, so collapse silently fails to
    persist.

    `menu` supplies the mobile slideover's accessible title and description.
    UDashboardSidebar renders `t('dashboardSidebar.title')`, but that key is
    absent from Nuxt UI's shipped English locale, so the dialog announces the
    literal string "dashboardSidebar.title" to screen readers. `menu` is
    v-bound after those defaults, so it overrides them.
  -->
  <UDashboardGroup unit="rem" storage-key="soberlife-shell">
    <UDashboardSidebar
      id="main"
      collapsible
      resizable
      :default-size="16"
      :min-size="13"
      :max-size="22"
      :collapsed-size="4"
      :menu="{
        title: 'Navigation',
        description: 'SoberLife sections and your account',
      }"
      :ui="{
        root: 'border-r border-[var(--color-hairline)] bg-[var(--color-elevated)]',
        footer: 'border-t border-[var(--color-hairline)]',
      }"
    >
      <!-- Brand + collapse control -->
      <template #header="{ collapsed }">
        <div class="flex w-full items-center gap-2" :class="collapsed && 'justify-center'">
          <NuxtLink
            to="/"
            class="flex min-h-11 min-w-0 items-center gap-2.5 rounded-[var(--ui-radius)]"
            :aria-label="'SoberLife — census'"
          >
            <span
              class="grid size-[22px] shrink-0 place-items-center rounded-[5px] bg-[var(--color-ink)]"
            >
              <span class="size-2 rounded-[2px] bg-white" />
            </span>
            <span
              v-if="!collapsed"
              class="truncate text-[14.5px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]"
            >
              SoberLife
            </span>
          </NuxtLink>

          <!-- Desktop collapse toggle. Hidden on mobile, where the sidebar is a
               slideover driven by the navbar's own toggle. -->
          <UDashboardSidebarCollapse
            v-if="!collapsed"
            class="ms-auto hidden lg:inline-flex"
            color="neutral"
            variant="ghost"
          />
        </div>
      </template>

      <!-- Nav. `tooltip` surfaces the label on hover once railed. -->
      <template #default="{ collapsed }">
        <UDashboardSidebarCollapse
          v-if="collapsed"
          class="mb-1 hidden self-center lg:inline-flex"
          color="neutral"
          variant="ghost"
        />
        <UNavigationMenu
          :items="itemsFor(collapsed)"
          :collapsed="collapsed"
          orientation="vertical"
          tooltip
          :ui="{ link: 'min-h-11' }"
        />
      </template>

      <template #footer="{ collapsed }">
        <AppUserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
