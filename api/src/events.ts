// ============================================================
// Live-update fan-out for Server-Sent Events (SSE).
//
// When a POST changes a workspace, the api publishes a small "something changed"
// notification to every browser currently subscribed to that workspace's event
// stream; each browser then pulls + merges immediately instead of waiting for
// the 30s poll. The payload carries only updated_at + updated_by (not the data),
// so a client can skip its own writes and skip pulls it already has.
//
// This is an IN-PROCESS hub: it works because there is a single `api` container.
// If the api is ever scaled to multiple replicas, replace the in-memory map with
// Postgres LISTEN/NOTIFY (publish on the same connection that commits the POST)
// so a change on one replica reaches subscribers on another.
// ============================================================

export interface UpdateEvent {
  updated_at: string
  updated_by: string | null
}

type Subscriber = (chunk: string) => void

const subscribers = new Map<string, Set<Subscriber>>()

/** Register an SSE writer for a workspace. Returns an unsubscribe function. */
export function subscribe(key: string, write: Subscriber): () => void {
  let set = subscribers.get(key)
  if (!set) {
    set = new Set()
    subscribers.set(key, set)
  }
  set.add(write)
  return () => {
    const s = subscribers.get(key)
    if (!s) return
    s.delete(write)
    if (s.size === 0) subscribers.delete(key)
  }
}

/** Notify every subscriber of `key` that its data changed. Best-effort. */
export function publish(key: string, payload: UpdateEvent): void {
  const set = subscribers.get(key)
  if (!set || set.size === 0) return
  const frame = `event: update\ndata: ${JSON.stringify(payload)}\n\n`
  for (const write of set) {
    try {
      write(frame)
    } catch {
      /* a dead socket is cleaned up by its own close handler */
    }
  }
}

/** For diagnostics/tests. */
export function subscriberCount(key: string): number {
  return subscribers.get(key)?.size ?? 0
}
