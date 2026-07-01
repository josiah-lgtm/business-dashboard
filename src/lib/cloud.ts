// ============================================================
// Cloud sync — shared state across devices via team-tracker /api/external/kv
// Ported from the legacy app. localStorage is the source of truth; this
// mirrors to the shared server on every save (debounced) and pulls on boot
// + every 30s. Last-write-wins on meta.cloudUpdatedAt vs server updated_at.
// ============================================================
import { ref } from 'vue'
import { S } from './store-access'
import type { CloudSync, State } from '@/types'

export const CLOUD_DEFAULTS: CloudSync = {
  // Same-origin by default → the nginx proxy forwards to the api (no CORS) and
  // injects the bearer token server-side. Override with VITE_API_URL for dev
  // (e.g. http://localhost:54330/external/kv).
  url: import.meta.env.VITE_API_URL || '/api/external/kv',
  // Server persistence on out of the box, into the one shared workspace.
  enabled: true,
  key: import.meta.env.VITE_WORKSPACE_KEY || '',
}

// Old endpoint we migrate persisted configs away from (see loadState in the store).
export const LEGACY_TRACKER_URL = 'https://tracker.agencyadvanta.com/api/external/kv'

// Request headers for sync calls. In production the nginx proxy injects the
// Authorization header server-side and VITE_API_TOKEN is unset, so nothing leaks
// into the bundle. VITE_API_TOKEN is a dev/direct convenience only.
function cloudHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (import.meta.env.VITE_API_TOKEN) h.Authorization = `Bearer ${import.meta.env.VITE_API_TOKEN}`
  return h
}

export const cloudStatus = ref<{ text: string; cls: string; visible: boolean }>({
  text: '',
  cls: '',
  visible: false,
})

let cloudTimer: ReturnType<typeof setTimeout> | null = null
let cloudInflight = false
let cloudPendingPush = false
let cloudLastPulledAt: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

// Store-provided hooks (registered on boot) — keep this module free of a
// hard dependency on the Pinia store (avoids an import cycle).
// applyRemote MERGES the remote blob into local and returns whether the merge
// changed anything (→ we push the union back so the server holds everyone's data).
let _applyRemote: (value: State, updatedAt: string, preferRemote: boolean) => boolean = () => false
let _setCloudMeta: (updatedAt: string) => void = () => {}

export function registerCloudHooks(hooks: {
  applyRemote: (value: State, updatedAt: string, preferRemote: boolean) => boolean
  setCloudMeta: (updatedAt: string) => void
}) {
  _applyRemote = hooks.applyRemote
  _setCloudMeta = hooks.setCloudMeta
}

export function cloudCfg(): CloudSync {
  const s = S()
  if (!s.cloudSync) s.cloudSync = { ...CLOUD_DEFAULTS }
  return s.cloudSync
}

export function cloudIsEnabled(): boolean {
  const c = cloudCfg()
  return !!(c.enabled && c.key && c.url)
}

export function setCloudStatus(text: string, cls?: string) {
  cloudStatus.value = { text, cls: cls || '', visible: cloudIsEnabled() }
}

// PULL — fetch remote and replace local if remote is newer.
export async function cloudPull(): Promise<{ ok: boolean; applied?: boolean; reason?: string; error?: string }> {
  if (!cloudIsEnabled()) return { ok: false, reason: 'disabled' }
  const cfg = cloudCfg()
  setCloudStatus('Syncing ↓', 'syncing')
  try {
    const r = await fetch(`${cfg.url}/${encodeURIComponent(cfg.key)}`, {
      method: 'GET',
      headers: cloudHeaders(),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    if (!data || data.value == null) {
      setCloudStatus('Synced (no remote yet)', 'ok')
      cloudPushNow()
      return { ok: true, applied: false }
    }
    const remoteUpdated = data.updated_at || ''
    const localUpdated = S().meta?.cloudUpdatedAt || ''
    // Always merge (not just when remote is "newer"): an older-looking blob can
    // still hold entries we lack — e.g. a teammate's data pushed before we were
    // online. preferRemote is the tiebreak for genuine same-entity conflicts.
    const preferRemote = remoteUpdated > localUpdated
    const changed = _applyRemote(data.value as State, remoteUpdated, preferRemote)
    cloudLastPulledAt = remoteUpdated
    if (changed) {
      // The merge produced a superset the server may not have yet — push it back
      // so every device converges on the union of everyone's data.
      setCloudStatus('Synced ✓ (merged)', 'ok')
      cloudPushNow()
      return { ok: true, applied: true }
    }
    setCloudStatus('Synced ✓', 'ok')
    return { ok: true, applied: false }
  } catch (e: any) {
    console.error('cloudPull failed:', e)
    setCloudStatus('Offline (local only)', 'err')
    return { ok: false, error: e?.message }
  }
}

// PUSH — debounced so rapid edits collapse.
export function cloudPushSoon() {
  if (!cloudIsEnabled()) return
  cloudPendingPush = true
  if (cloudTimer) clearTimeout(cloudTimer)
  cloudTimer = setTimeout(cloudPushNow, 1500)
  setCloudStatus('Saving to cloud…', 'syncing')
}

export async function cloudPushNow() {
  if (!cloudIsEnabled()) return
  if (cloudInflight) {
    cloudPendingPush = true
    return
  }
  if (cloudTimer) clearTimeout(cloudTimer)
  cloudInflight = true
  cloudPendingPush = false
  const cfg = cloudCfg()
  try {
    const r = await fetch(`${cfg.url}/${encodeURIComponent(cfg.key)}`, {
      method: 'POST',
      headers: cloudHeaders(),
      body: JSON.stringify({ value: S(), updated_by: cloudWho() }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    const updatedAt = data.updated_at || new Date().toISOString()
    _setCloudMeta(updatedAt) // writes localStorage without re-triggering a push
    setCloudStatus(`Synced ✓ ${cloudRelativeTime(updatedAt)}`, 'ok')
  } catch (e) {
    console.error('cloudPushNow failed:', e)
    setCloudStatus('Cloud save failed — will retry', 'err')
  } finally {
    cloudInflight = false
    if (cloudPendingPush) cloudPushSoon()
  }
}

// Synchronous best-effort flush during page unload.
export function cloudFlushNow() {
  if (!cloudIsEnabled() || !cloudPendingPush) return
  const cfg = cloudCfg()
  try {
    fetch(`${cfg.url}/${encodeURIComponent(cfg.key)}`, {
      method: 'POST',
      headers: cloudHeaders(),
      body: JSON.stringify({ value: S(), updated_by: cloudWho() }),
      keepalive: true,
    }).catch(() => {})
    cloudPendingPush = false
  } catch (_) {}
}

export function cloudWho(): string {
  let dev = localStorage.getItem('bd-device-label')
  if (!dev) {
    dev = (navigator.platform || 'web') + '-' + Math.random().toString(36).slice(2, 6)
    try {
      localStorage.setItem('bd-device-label', dev)
    } catch (_) {}
  }
  return dev
}

export function cloudRelativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const sec = Math.round((Date.now() - then) / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function cloudGenerateKey(): string {
  const seed = (S().business?.name || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 20)
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
  return `bd-${seed}-${rand}`
}

export function cloudStartPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && cloudIsEnabled() && !cloudInflight && !cloudPendingPush) {
      cloudPull()
    }
  }, 30_000)
}

// ---- live updates (SSE) ----
// Open a Server-Sent Events stream so a teammate's change triggers an immediate
// pull instead of waiting for the 30s poll. The poll above stays as a fallback
// for browsers/networks where the stream can't connect. EventSource can't send
// an Authorization header, but in prod the nginx proxy injects the bearer for
// same-origin /api requests (same as GET/POST), so no token is needed here.
let eventStream: EventSource | null = null

export function cloudStartEventStream() {
  cloudStopEventStream()
  if (typeof EventSource === 'undefined') return // ancient browser -> poll only
  if (!cloudIsEnabled()) return
  const cfg = cloudCfg()
  try {
    const es = new EventSource(`${cfg.url}/${encodeURIComponent(cfg.key)}/events`)
    eventStream = es
    es.addEventListener('update', (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data)
        // Ignore the echo of our own write — we already hold that data.
        if (payload?.updated_by && payload.updated_by === cloudWho()) return
        // Only pull if the server is ahead of what we last reconciled.
        if (!payload?.updated_at || payload.updated_at > (cloudLastPulledAt || '')) cloudPull()
      } catch {
        cloudPull()
      }
    })
    // On error the browser auto-reconnects (honoring the server's retry hint);
    // the 30s poll covers the gap. Nothing to do here.
    es.onerror = () => {}
  } catch (e) {
    console.error('cloudStartEventStream failed:', e)
  }
}

export function cloudStopEventStream() {
  if (eventStream) {
    eventStream.close()
    eventStream = null
  }
}
