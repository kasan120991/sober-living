import { io } from 'socket.io-client'
import { useDebounceFn } from '@vueuse/core'

/**
 * The realtime invalidation client.
 *
 * The socket carries NO data — the server emits one event, `changed`, whose
 * payload is a timestamp. Everything on screen updates by refetching over the
 * authenticated HTTP API, so what a device may see is decided per request by
 * the server, exactly as it is without the socket. See CLAUDE.md module 12.
 *
 * Module-scoped singleton rather than useState: the socket is not reactive
 * state, and module scope survives component churn and HMR re-runs — connect()
 * is idempotent for the same reason.
 */
let socket = null
const callbacks = new Set()

export function useRealtime() {
  const connected = useState('realtime.connected', () => false)

  function connect() {
    if (socket) return
    const config = useRuntimeConfig()

    // Captured while the Nuxt context is live; the handlers below run outside
    // it, and these closures are what make that safe.
    const { refresh: refreshStatus } = useFacilityStatus()
    const { refresh: refreshBell } = useNotifications()

    const refreshAll = () => {
      refreshStatus()
      refreshBell()
      for (const fn of callbacks) fn()
    }
    // Debounced: the actor's own mutation arrives twice — the local emit
    // handler and the socket echo — and should cost one refetch, not two.
    const onChanged = useDebounceFn(refreshAll, 200)

    socket = io(config.public.apiBase, { withCredentials: true })
    socket.on('connect', () => {
      connected.value = true
      // Anything that changed while disconnected was never signalled — a
      // reconnect refetches rather than trusting the gap was quiet.
      refreshAll()
    })
    socket.on('changed', onChanged)
    socket.on('disconnect', () => {
      connected.value = false
    })
  }

  function disconnect() {
    socket?.disconnect()
    socket = null
    connected.value = false
  }

  return { connected, connect, disconnect }
}

/**
 * Page hook: run `fn` whenever the server signals a change. Registers for the
 * life of the calling component — a page's load() keeps its own table live
 * with one line.
 */
export function onRealtimeChanged(fn) {
  callbacks.add(fn)
  onScopeDispose(() => callbacks.delete(fn))
}
