<script setup>
// The header search field and its palette.
//
// Built on Dialog + Input rather than shadcn's Command: adding that component
// makes the CLI offer to overwrite button/index.ts, which carries our 44px
// floor, and the interaction here is small enough not to need cmdk.
//
// The query is never put in a URL, never stored, and never logged. It is
// somebody's name, and under 42 CFR Part 2 confirming that a named person is
// here is itself the disclosure — see server/src/services/search.js for the
// limits that back this up.
import { Search, UserRound, Building2 } from '@lucide/vue'

const { search } = useSearch()
const router = useRouter()

const open = ref(false)
const query = ref('')
const results = ref({ residents: [], apartments: [], tooShort: true })
const busy = ref(false)
const cursor = ref(0)

/** Flat list in render order, so the keyboard and the mouse agree. */
const flat = computed(() => [
  ...results.value.residents.map((r) => ({ kind: 'resident', ...r })),
  ...results.value.apartments.map((a) => ({ kind: 'apartment', ...a })),
])

let timer
watch(query, (q) => {
  clearTimeout(timer)
  cursor.value = 0
  if (!q.trim()) {
    results.value = { residents: [], apartments: [], tooShort: true }
    return
  }
  busy.value = true
  // Debounced: a request per keystroke would put a name in the access log of
  // every proxy between here and the API, several times per lookup.
  timer = setTimeout(async () => {
    try {
      results.value = await search(q)
    } finally {
      busy.value = false
    }
  }, 180)
})

watch(open, (isOpen) => {
  if (isOpen) return
  // Cleared on close, so a name is not sitting in memory behind a shared
  // house phone that somebody else picks up.
  query.value = ''
  results.value = { residents: [], apartments: [], tooShort: true }
  cursor.value = 0
})

function go(item) {
  open.value = false
  router.push(item.kind === 'resident' ? `/residents/${item.id}` : `/apartments/${item.id}`)
}

function onKey(e) {
  if (!flat.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    cursor.value = (cursor.value + 1) % flat.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    cursor.value = (cursor.value - 1 + flat.value.length) % flat.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    go(flat.value[cursor.value])
  }
}

function onShortcut(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    open.value = true
  }
}
onMounted(() => window.addEventListener('keydown', onShortcut))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShortcut)
  clearTimeout(timer)
})

const isMac = computed(() =>
  import.meta.client ? /Mac|iPhone|iPad/.test(navigator.platform) : true,
)
</script>

<template>
  <!-- A field on sm and up, an icon button below — on a phone a full-width
       field would leave nothing for the status pill and the bell. -->
  <button
    type="button"
    class="border-border bg-muted/55 text-muted-foreground hover:bg-muted flex h-9 min-w-0 items-center gap-2 rounded-full border px-3 text-[13.5px] transition-colors sm:w-full sm:max-w-[360px]"
    :aria-label="'Search residents and apartments'"
    @click="open = true"
  >
    <Search class="size-4 shrink-0" aria-hidden="true" />
    <span class="hidden truncate sm:inline">Search residents, apartments…</span>
    <kbd
      class="border-border bg-background ms-auto hidden rounded border px-1.5 py-px text-[10.5px] sm:inline"
    >
      {{ isMac ? '⌘' : 'Ctrl ' }}K
    </kbd>
  </button>

  <Dialog v-model:open="open">
    <DialogContent class="gap-0 overflow-hidden p-0 sm:max-w-[560px]">
      <DialogHeader class="sr-only">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription>Find a resident or an apartment.</DialogDescription>
      </DialogHeader>

      <div class="flex items-center gap-2 border-b px-4">
        <Search class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <input
          v-model="query"
          class="placeholder:text-muted-foreground h-12 w-full bg-transparent text-[14px] outline-none"
          placeholder="Search residents, apartments…"
          autocomplete="off"
          autofocus
          @keydown="onKey"
        />
      </div>

      <div class="max-h-[min(22rem,55vh)] overflow-y-auto p-1.5">
        <p v-if="results.tooShort" class="text-muted-foreground px-3 py-6 text-center text-sm">
          Type at least two letters.
        </p>
        <p v-else-if="busy" class="text-muted-foreground px-3 py-6 text-center text-sm">
          Searching…
        </p>
        <p v-else-if="!flat.length" class="text-muted-foreground px-3 py-6 text-center text-sm">
          Nothing matching “{{ query }}”.
        </p>

        <template v-else>
          <p
            v-if="results.residents.length"
            class="text-muted-foreground px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.1em] uppercase"
          >
            Residents
          </p>
          <button
            v-for="(r, i) in results.residents"
            :key="r.id"
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start"
            :class="cursor === i ? 'bg-muted' : 'hover:bg-muted/60'"
            @mousemove="cursor = i"
            @click="go({ kind: 'resident', ...r })"
          >
            <UserRound class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-[13.5px]">{{ r.fullName }}</span>
            <span class="text-muted-foreground shrink-0 text-xs">
              {{ r.bed ?? (r.active ? 'No bed' : 'Discharged') }}
            </span>
          </button>

          <p
            v-if="results.apartments.length"
            class="text-muted-foreground px-2.5 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.1em] uppercase"
          >
            Apartments
          </p>
          <button
            v-for="(a, i) in results.apartments"
            :key="a.id"
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start"
            :class="
              cursor === results.residents.length + i ? 'bg-muted' : 'hover:bg-muted/60'
            "
            @mousemove="cursor = results.residents.length + i"
            @click="go({ kind: 'apartment', ...a })"
          >
            <Building2 class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-[13.5px]">{{ a.name }}</span>
            <span class="text-muted-foreground shrink-0 text-xs">
              {{ a.cohort === 'MEN' ? 'Men' : 'Women' }} · {{ a.bedCount }} beds
            </span>
          </button>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
