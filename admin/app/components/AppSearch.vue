<script setup>
// The header search field and its palette.
//
// Built on the vendored Command (reka-ui's Listbox), which replaced a
// hand-rolled listbox: this file used to carry its own ArrowUp/ArrowDown/Enter
// handler and a `cursor` ref, and hand-written roving focus is where keyboard
// and screen-reader behaviour quietly goes wrong. The note that used to sit
// here said Command could not be added because the CLI offers to overwrite
// button/index.ts, which carries our 44px floor. That is now handled by
// `npm run ui:add`, which declines every overwrite and restores main.css.
//
// THE SERVER IS THE ONLY FILTER, and that is why the input below is a bare
// ListboxFilter rather than CommandInput. CommandInput v-models reka's own
// `filterState.search`, which makes Command filter the rendered rows a second
// time — and the two predicates genuinely differ: the server matches
// `firstName` OR `lastName` as separate columns (services/search.js), while
// Command matches each row's textContent. Leaving filterState.search empty
// means every row the server returned is rendered, exactly as returned.
//
// The query is never put in a URL, never stored, and never logged. It is
// somebody's name, and under 42 CFR Part 2 confirming that a named person is
// here is itself the disclosure — see server/src/services/search.js for the
// limits that back this up.
import { Search, UserRound, Building2 } from '@lucide/vue'
import { ListboxFilter } from 'reka-ui'

const { search } = useSearch()
const router = useRouter()

const open = ref(false)
const query = ref('')
const results = ref({ residents: [], apartments: [], tooShort: true })
const busy = ref(false)

const hasResults = computed(
  () => results.value.residents.length > 0 || results.value.apartments.length > 0,
)

let timer
watch(query, (q) => {
  clearTimeout(timer)
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
})

function go(item) {
  open.value = false
  router.push(item.kind === 'resident' ? `/residents/${item.id}` : `/apartments/${item.id}`)
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

  <CommandDialog
    v-model:open="open"
    title="Search"
    description="Find a resident or an apartment."
    class="sm:max-w-[560px]"
  >
    <!-- InputGroup + ListboxFilter is CommandInput's own markup, minus the
         v-model onto filterState.search. See the note at the top. -->
    <div class="p-1 pb-0">
      <InputGroup class="bg-input/50 h-9">
        <ListboxFilter
          v-model="query"
          auto-focus
          autocomplete="off"
          placeholder="Search residents, apartments…"
          class="w-full text-sm outline-hidden"
        />
        <InputGroupAddon>
          <Search class="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </InputGroupAddon>
      </InputGroup>
    </div>

    <CommandList>
      <!-- CommandEmpty keys off filterState.search, which we deliberately leave
           empty, so it can never render. These three states are ours: too
           short, in flight, and a real miss are different answers and the
           middle one must not read as "nobody by that name". -->
      <p v-if="results.tooShort" class="text-muted-foreground px-3 py-6 text-center text-sm">
        Type at least two letters.
      </p>
      <p v-else-if="busy" class="text-muted-foreground px-3 py-6 text-center text-sm">
        Searching…
      </p>
      <p v-else-if="!hasResults" class="text-muted-foreground px-3 py-6 text-center text-sm">
        Nothing matching “{{ query }}”.
      </p>

      <template v-else>
        <CommandGroup v-if="results.residents.length" heading="Residents">
          <CommandItem
            v-for="r in results.residents"
            :key="r.id"
            :value="`resident:${r.id}`"
            @select="go({ kind: 'resident', ...r })"
          >
            <UserRound class="text-muted-foreground shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ r.fullName }}</span>
            <span class="text-muted-foreground shrink-0 text-xs">
              {{ r.bed ?? (r.active ? 'No bed' : 'Discharged') }}
            </span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup v-if="results.apartments.length" heading="Apartments">
          <CommandItem
            v-for="a in results.apartments"
            :key="a.id"
            :value="`apartment:${a.id}`"
            @select="go({ kind: 'apartment', ...a })"
          >
            <Building2 class="text-muted-foreground shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ a.name }}</span>
            <span class="text-muted-foreground shrink-0 text-xs">
              {{ a.cohort === 'MEN' ? 'Men' : 'Women' }} · {{ a.bedCount }} beds
            </span>
          </CommandItem>
        </CommandGroup>
      </template>
    </CommandList>
  </CommandDialog>
</template>
