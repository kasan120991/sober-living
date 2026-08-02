<script setup>
// The one page header, shaped after shadcn's sidebar-08: trigger, rule,
// breadcrumb, actions pushed right. Three files were hand-rolling this.
//
// `md:rounded-t-2xl` is the inset variant's doing — SidebarInset becomes a
// rounded card from md up, and a sticky header with square corners would
// otherwise sit over its top corners. It is 2xl, not the xl shadcn ships:
// the preset restyled SidebarInset, and the two have to agree or the card
// shows as a sliver outside the header's corners.
defineProps({
  title: { type: String, required: true },
  /**
   * Ancestor crumbs, outermost first: `[{ label, to }]`. Empty on a top-level
   * page, where the trail is just the title.
   */
  parents: { type: Array, default: () => [] },
})
</script>

<template>
  <header
    class="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 px-4 md:rounded-t-2xl"
  >
    <SidebarTrigger class="-ml-1" />
    <Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />

    <Breadcrumb class="min-w-0">
      <BreadcrumbList class="flex-nowrap">
        <!-- sidebar-08 hides ancestors below md. We keep them: they replaced a
             back arrow, and losing the way back on a phone is the one device
             where a tech actually needs it. Our trails are two deep. -->
        <template v-for="p in parents" :key="p.to">
          <BreadcrumbItem>
            <BreadcrumbLink as-child>
              <NuxtLink :to="p.to">{{ p.label }}</NuxtLink>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
        </template>

        <!-- Deliberately unstyled beyond truncation: the current crumb takes the
             breadcrumb's own size and weight, and is distinguished from its
             ancestors by colour alone. It is still the page's <h1> — that is
             semantics, not a licence to make it look like a heading. -->
        <BreadcrumbItem class="min-w-0">
          <BreadcrumbPage as="h1" class="truncate">
            {{ title }}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="ml-auto flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
