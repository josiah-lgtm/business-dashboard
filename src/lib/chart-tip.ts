// Lightweight, framework-friendly tooltip for the hand-built SVG/HTML charts.
//
// The charts render to plain strings injected via v-html, so Vue event binding
// isn't available on their internals. Instead each hoverable element carries a
// `data-tip` attribute holding pre-built markup, and a single delegated
// directive (`v-chart-tip`) on the wrapper shows one shared floating tooltip.
import type { Directive } from 'vue'
import { escapeHtml } from './format'

// ---- Shared floating tooltip element (one per document) ----
let tipEl: HTMLDivElement | null = null

function getTip(): HTMLDivElement {
  if (tipEl && tipEl.isConnected) return tipEl
  const el = document.createElement('div')
  el.className = 'chart-tip'
  el.setAttribute('role', 'tooltip')
  document.body.appendChild(el)
  tipEl = el
  return el
}

function place(el: HTMLDivElement, x: number, y: number) {
  const gap = 16
  const r = el.getBoundingClientRect()
  // Prefer above-right of the cursor; flip when it would clip the viewport.
  let left = x + gap
  if (left + r.width > window.innerWidth - 8) left = x - r.width - gap
  left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8))
  let top = y - r.height - gap
  if (top < 8) top = y + gap
  top = Math.max(8, Math.min(top, window.innerHeight - r.height - 8))
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

function show(html: string, x: number, y: number) {
  const el = getTip()
  if (el.dataset.html !== html) {
    el.innerHTML = html
    el.dataset.html = html
  }
  el.classList.add('is-on')
  place(el, x, y)
}

function hide() {
  if (tipEl) {
    tipEl.classList.remove('is-on')
    tipEl.dataset.html = ''
  }
}

interface TipHandlers {
  move: (e: PointerEvent) => void
  leave: () => void
}

// `v-chart-tip` — attach to the wrapper around a v-html chart. Surfaces a styled
// tooltip for any descendant carrying a `data-tip` attribute.
export const vChartTip: Directive<HTMLElement & { __chartTip?: TipHandlers }> = {
  mounted(el) {
    const move = (e: PointerEvent) => {
      const hit = (e.target as Element | null)?.closest('[data-tip]') as HTMLElement | null
      if (!hit) {
        hide()
        return
      }
      show(hit.getAttribute('data-tip') || '', e.clientX, e.clientY)
    }
    const leave = () => hide()
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    el.__chartTip = { move, leave }
  },
  unmounted(el) {
    if (el.__chartTip) {
      el.removeEventListener('pointermove', el.__chartTip.move)
      el.removeEventListener('pointerleave', el.__chartTip.leave)
    }
    hide()
  },
}

// ---- Markup builders used by the string renderers ----
export interface TipRow {
  label: string
  value: string
  color?: string
  muted?: boolean
}

// Build the inner tooltip markup: an uppercase header plus colored key/value
// rows. All dynamic text is HTML-escaped here; markup uses single quotes so it
// embeds cleanly inside a double-quoted attribute.
export function tipMarkup(title: string, rows: TipRow[]): string {
  const head = title ? `<div class='ct-head'>${escapeHtml(title)}</div>` : ''
  const body = rows
    .map(
      (r) =>
        `<div class='ct-row${r.muted ? ' is-muted' : ''}'>` +
        `<span class='ct-k'>${r.color ? `<i style='background:${r.color}'></i>` : ''}${escapeHtml(r.label)}</span>` +
        `<span class='ct-v'>${escapeHtml(r.value)}</span>` +
        `</div>`,
    )
    .join('')
  return head + body
}

// Encode tooltip markup for safe embedding in a double-quoted `data-tip="…"`
// attribute. getAttribute() decodes one entity layer on read, restoring the
// original markup for innerHTML.
export function tipAttr(markup: string): string {
  return `data-tip="${markup.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
}
