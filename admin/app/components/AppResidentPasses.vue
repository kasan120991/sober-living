<script setup>
// The resident record's Travel passes section — read-only apart from filing.
// Reviewing happens on /passes, where a manager sees the whole queue rather
// than one person at a time; that split is the same one the Schedule section
// makes, and it is what stops twelve rail sections each growing an editor.
//
// It leads with ELIGIBILITY, which no other rail section does, and the reason
// is domain rather than layout: a pass is the one thing on this record somebody
// is refused by RULE rather than by judgement. "Phase 1 · 90 days in the
// programme, day 12" answers the question before it is asked, and answers it
// with the rule rather than with a shrug.
//
// `overdue` is the SERVER's flag, not a client re-derivation. The board ticks
// every 30 seconds because a pass crossing into overdue is no write and no
// socket event will come; a record page is opened deliberately and read in a
// minute, so the value it loaded with is the value it needs.
import { Plane } from '@lucide/vue'
import { toneClass } from '~/utils/schedule.js'
import { nightsLabel, passDisplay } from '~/utils/passes.js'
import { facilityDateOf, humanDate } from '~/utils/facilityTime.js'

const props = defineProps({
  residentId: { type: String, required: true },
  residentName: { type: String, default: null },
})

const { getResidentPasses } = usePasses()

const data = ref(null)
const pending = ref(true)
const requestOpen = ref(false)

async function load() {
  pending.value = !data.value
  data.value = await getResidentPasses(props.residentId)
  pending.value = false
}
await load()
onRealtimeChanged(load)

const hasActiveStay = computed(() => data.value?.hasActiveStay !== false)
const eligibility = computed(() => data.value?.eligibility ?? null)
const passes = computed(() => data.value?.passes ?? [])

const dayLabel = (at) => humanDate(facilityDateOf(at), { short: true })
</script>

<template>
  <div class="flex min-w-0 flex-col gap-5">
    <p v-if="pending" class="text-muted-foreground text-sm">Loading travel passes…</p>

    <p v-else-if="!hasActiveStay" class="text-muted-foreground text-sm">
      No active stay. A pass belongs to the stay it was granted on, so a resident who
      returns starts fresh.
    </p>

    <template v-else>
      <AppPassRequestDialog
        v-model:open="requestOpen"
        :resident-id="residentId"
        :resident-name="residentName"
        @saved="load"
      />

      <!-- ── Eligibility ────────────────────────────────────────────────── -->
      <section>
        <div class="mb-2 flex items-center gap-2">
          <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            Eligibility
          </h2>
          <!-- Only when they are eligible. The server refuses otherwise, and
               module 10's rule applies — a button that always 403s is worse
               than no button. Its absence is not silent here: the band it sits
               beside states the rule that removed it. -->
          <Button
            v-if="eligibility?.eligible"
            variant="outline"
            size="sm"
            class="ms-auto"
            @click="requestOpen = true"
          >
            <Plane class="size-4" /> Request a pass
          </Button>
        </div>

        <div class="bg-card rounded-md border p-4">
          <p class="text-[14px]">
            {{ eligibility?.eligible ? 'Eligible for travel passes.' : 'Not eligible yet.' }}
          </p>
          <!-- The RULE, not merely the refusal. Surfacing it here is the whole
               point of the band: without it, a resident learns the rule by
               having a request denied a week later. -->
          <p v-if="eligibility?.reason" class="text-muted-foreground mt-1 text-xs">
            {{ eligibility.reason }}
          </p>
        </div>
      </section>

      <!-- ── The passes ─────────────────────────────────────────────────── -->
      <section>
        <h2 class="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
          Passes
        </h2>

        <p v-if="!passes.length" class="text-muted-foreground text-sm">
          No travel passes on this stay.
        </p>

        <div v-else class="overflow-hidden rounded-md border">
          <div
            v-for="p in passes"
            :key="p.id"
            class="bg-card flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2.5 last:border-b-0"
            :class="p.overdue ? 'shadow-[inset_3px_0_0_var(--destructive)]' : ''"
          >
            <span class="w-[9.5rem] shrink-0 text-[13px] tabular-nums">
              {{ dayLabel(p.departAt) }} → {{ dayLabel(p.returnBy) }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13.5px]">{{ p.destination }}</span>
              <span class="text-muted-foreground block truncate text-[11px]">
                {{ nightsLabel(p.nights) }}
                <template v-if="p.reviewNote"> · {{ p.reviewNote }}</template>
              </span>
            </span>
            <Badge
              variant="outline"
              class="shrink-0 text-[10px]"
              :class="toneClass(p.overdue ? 'destructive' : passDisplay(p.status).tone)"
            >
              {{ p.overdue ? 'Overdue back' : passDisplay(p.status).label }}
            </Badge>
          </div>
        </div>

        <p class="text-muted-foreground mt-2 text-xs">
          Passes are approved and closed on the
          <NuxtLink to="/passes" class="underline underline-offset-2">passes board</NuxtLink>.
          The bed is held for the whole absence.
        </p>
      </section>
    </template>
  </div>
</template>
