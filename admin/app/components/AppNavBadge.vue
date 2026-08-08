<script setup>
// The count on a sidebar entry.
//
// TWO RENDERINGS OF ONE NUMBER, because the rail has two widths:
//   expanded  — SidebarMenuBadge, the vendored component, at last used
//   collapsed — a dot, because the icon rail is a 32px button and "12" will not
//               fit in it
//
// The collapsed dot is not decoration and not optional. SidebarMenuBadge hides
// itself at `collapsible=icon`, and collapsing is a PERSISTED choice — a cookie
// (SIDEBAR_COOKIE_NAME) — so a badge that simply vanishes means the two roles
// who work in this app on a desktop all day collapse the rail once and never
// see the signal again. The dot keeps "something is wrong, and how wrong"; the
// count is not lost either, because SidebarMenuButton renders a tooltip ONLY
// when collapsed and it carries the number. Same trade AppResidentRail makes to
// keep its dots on the sheet trigger below `md`.
//
// Both are aria-hidden. SidebarMenuBadge is pointer-events-none and sits
// OUTSIDE the anchor, so a reader would otherwise announce a stray number after
// the label; the count reaches the accessible name through the link's
// aria-label instead — see useNavBadges().labelFor.
import { NAV_TONE } from '~/composables/useNavBadges.js'

const props = defineProps({
  /** `{ count, tone }` from useNavBadges(). Rendered only when there is one. */
  badge: { type: Object, required: true },
})

// TINTED, not solid. The preset's own `destructive` Badge variant is a tint
// (bg-destructive/10 text-destructive), and `bg-warning/15 text-warning` is
// what the rest of the app writes wherever a `warning` Badge variant would be
// if shadcn shipped one. Thirteen nav rows is not the place for a solid red
// pill — and a `warning` variant is deliberately NOT added to the vendored
// Badge, which would change every badge in the app for one new caller.
//
// THE peer- OVERRIDES ARE NOT BELT AND BRACES. SidebarMenuBadge's base carries
// `peer-hover/menu-button:text-sidebar-accent-foreground` and
// `peer-data-active/menu-button:text-sidebar-accent-foreground`, and
// tailwind-merge will NOT drop those for a plain `text-destructive` — a
// different modifier is a different key — while the peer variant also wins on
// specificity (0,3,0 against 0,1,0) whatever the source order. Without these
// the badge reverts to the sidebar colour on hover and on the very page you are
// standing on, which are the two states you look at it in.
const tint = computed(() =>
  props.badge.tone === NAV_TONE.CRITICAL
    ? {
        chip:
          'bg-destructive/10 dark:bg-destructive/20 text-destructive ' +
          'peer-hover/menu-button:text-destructive peer-data-active/menu-button:text-destructive',
        dot: 'bg-destructive',
      }
    : {
        chip:
          'bg-warning/15 text-warning ' +
          'peer-hover/menu-button:text-warning peer-data-active/menu-button:text-warning',
        dot: 'bg-warning',
      },
)
</script>

<template>
  <SidebarMenuBadge :class="tint.chip" aria-hidden="true">{{ badge.count }}</SidebarMenuBadge>

  <!-- A SIBLING of SidebarMenuButton inside SidebarMenuItem (which is
       `relative`), never inside the NuxtLink: the button is `overflow-hidden`
       and would clip it. It cannot appear in the mobile sheet by construction —
       `data-collapsible` is only set on the desktop branch of Sidebar.vue, so
       this selector never matches there and the phone gets the full chip. -->
  <span
    class="pointer-events-none absolute top-1 right-1 hidden size-1.5 rounded-full group-data-[collapsible=icon]:block"
    :class="tint.dot"
    aria-hidden="true"
  />
</template>
