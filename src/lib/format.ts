// Date / id / misc formatting helpers — ported verbatim from the legacy app.
import { S } from './store-access'

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function isoMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function monthOf(dateStr: string): string {
  return dateStr ? dateStr.slice(0, 7) : ''
}

export function fmtMonth(id: string): string {
  if (!id) return '—'
  const [y, m] = id.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
}

export function fmtMonthShort(id: string): string {
  if (!id) return '—'
  const [y, m] = id.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: '2-digit' })
}

export function fmtDate(s: string | undefined | null): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return `${d}/${m}/${y % 100}`
}

export function catClass(cat: string): string {
  return 'cat-' + cat.toLowerCase().replace(/[^a-z]+/g, '-')
}

// Only needed where we hand-build SVG/HTML strings for v-html; Vue templates
// auto-escape, so prefer those.
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export function sortedMonthIds(): string[] {
  return Object.keys(S().months).sort()
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>
  return ((...a: any[]) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }) as T
}
