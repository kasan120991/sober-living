<script setup>
// The app bar. Shell, not page.
//
// It used to carry a breadcrumb whose last crumb was the page name. Now every
// page states its own name in the body, so repeating it here would cost 64px to
// say something already said forty pixels below. The bar does three things
// instead, none of which belong to any one screen:
//
//   search      — finding a resident is the most repeated task in the app
//   status      — one figure, the most urgent true thing about the house
//   the bell    — what has happened, and what needs a person
//
// The way back out of a detail page moved with the breadcrumb: AppPageHeading
// takes a `back` prop, so it sits with the title it belongs to.
//
// `md:rounded-t-2xl` is the inset variant's doing — SidebarInset becomes a
// rounded card from md up, and a sticky header with square corners would sit
// over its top corners. It is 2xl, not the xl shadcn ships: the preset
// restyled SidebarInset, and the two have to agree.
</script>

<template>
  <header
    class="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 px-4 md:rounded-t-2xl"
  >
    <SidebarTrigger class="-ml-1" />
    <Separator orientation="vertical" class="mr-1 data-[orientation=vertical]:h-4" />

    <AppSearch />

    <div class="ms-auto flex shrink-0 items-center gap-1.5">
      <slot name="actions" />
      <AppFacilityStatus />
      <AppNotifications />
    </div>
  </header>
</template>
