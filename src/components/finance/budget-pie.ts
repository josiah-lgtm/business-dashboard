// Mac-style SVG donut chart for budget allocation. Returns an inline SVG
// string — purely visual, rendered via v-html (ported from the legacy app's
// renderBudgetPie). No interactivity, so a string renderer is appropriate.
import { money } from '@/lib/money'
import { tipMarkup, tipAttr } from '@/lib/chart-tip'

export interface BudgetPieItem {
  label: string
  value: number
  color?: string
  icon?: string
}

export function renderBudgetPie(items: BudgetPieItem[], total: number): string {
  const size = 220,
    cx = size / 2,
    cy = size / 2,
    r = 85,
    rInner = 50
  if (!items.length || total <= 0) {
    return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${r - rInner}" />
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="var(--text-tertiary)" font-size="12" font-family="-apple-system">No budget</text>
    </svg>`
  }
  let acc = 0
  // Donut slices via path arcs
  const slices = items
    .map((it) => {
      const frac = it.value / total
      const start = acc * 2 * Math.PI - Math.PI / 2
      acc += frac
      const end = acc * 2 * Math.PI - Math.PI / 2
      const large = frac > 0.5 ? 1 : 0
      const x1 = cx + r * Math.cos(start),
        y1 = cy + r * Math.sin(start)
      const x2 = cx + r * Math.cos(end),
        y2 = cy + r * Math.sin(end)
      const x3 = cx + rInner * Math.cos(end),
        y3 = cy + rInner * Math.sin(end)
      const x4 = cx + rInner * Math.cos(start),
        y4 = cy + rInner * Math.sin(start)
      // Pull the slice outward along its mid-angle on hover.
      const mid = (start + end) / 2
      const tx = (Math.cos(mid) * 7).toFixed(2)
      const ty = (Math.sin(mid) * 7).toFixed(2)
      const tip = tipAttr(
        tipMarkup(`${it.icon ? it.icon + ' ' : ''}${it.label}`, [
          { label: 'Budget', value: money(it.value), color: it.color },
          { label: 'Share', value: `${(frac * 100).toFixed(1)}%` },
        ]),
      )
      return `<path class="bg-pie-slice" style="--tx:${tx}px;--ty:${ty}px" d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z" fill="${it.color}" stroke="var(--surface)" stroke-width="2" ${tip} />`
    })
    .join('')
  return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;display:block">
    ${slices}
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="var(--text-tertiary)" font-size="10.5" font-family="-apple-system" letter-spacing="0.06em">TOTAL</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="var(--text)" font-size="18" font-weight="700" font-family="-apple-system" font-variant-numeric="tabular-nums">${money(total)}</text>
  </svg>`
}
