// Chart renderers that build SVG/HTML strings — ported verbatim from the
// legacy app. Used via v-html for the purely-visual charts (no interactivity).
import { money, moneyShort } from './money'
import { catClass, fmtMonth, fmtMonthShort } from './format'
import { smoothPath, niceTicks } from './charts'
import { tipMarkup, tipAttr } from './chart-tip'
import { CATEGORY_ORDER } from './buckets'
import type { MonthCalc } from '@/types'

export interface TrendPoint {
  id: string
  val: number
  val2?: number
}

export function renderSpendBars(c: MonthCalc): string {
  const items = [
    ...Object.entries(c.categories).map(([cat, val]) => ({ label: cat, val, cls: catClass(cat) })),
    { label: 'Commissions', val: c.raw.commissionsTotal, cls: '' },
    { label: 'Salaries', val: c.raw.salariesTotal, cls: '' },
    { label: 'Refunds', val: c.refundsTotal, cls: '' },
  ]
    .filter((i) => i.val > 0)
    .sort((a, b) => b.val - a.val)
  if (!items.length) return '<div class="help">No spend yet for this month.</div>'
  const max = items[0].val
  const total = items.reduce((s, i) => s + i.val, 0)
  return `<div style="display:flex;flex-direction:column;gap:10px">
    ${items
      .map((i) => {
        const pct = (i.val / max) * 100
        const sharePct = total > 0 ? (i.val / total) * 100 : 0
        const tip = tipAttr(
          tipMarkup(i.label, [
            { label: 'Spend', value: money(i.val) },
            { label: 'Share of spend', value: `${sharePct.toFixed(1)}%` },
          ]),
        )
        return `<div class="ct-bar-row" ${tip} style="display:grid;grid-template-columns:170px 1fr 110px;gap:14px;align-items:center;font-size:13px">
        <div style="color:var(--text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-0.005em">${i.cls ? `<span class="pill ${i.cls}">${i.label}</span>` : i.label}</div>
        <div style="background:var(--surface-input);height:8px;border-radius:4px;position:relative;overflow:hidden">
          <div class="ct-bar-fill" style="background:linear-gradient(90deg,var(--accent),var(--accent-hover));height:100%;width:${pct}%;border-radius:4px;box-shadow:0 0 8px var(--accent-shadow)"></div>
        </div>
        <div style="text-align:right;font-variant-numeric:tabular-nums;color:var(--text);font-weight:500;letter-spacing:-0.01em">${money(i.val)}<span style="color:var(--text-tertiary);font-size:11px;font-weight:400;margin-left:6px">${sharePct.toFixed(0)}%</span></div>
      </div>`
      })
      .join('')}
  </div>`
}

export function renderTrendChart(
  points: TrendPoint[],
  color: string,
  color2?: string,
  labels?: { primary?: string; secondary?: string },
): string {
  if (!points.length) return '<div class="empty"><p>No data</p></div>'
  const labelP = labels?.primary || 'Value'
  const labelS = labels?.secondary || 'Value 2'
  const w = 800,
    h = 240
  const padL = 56,
    padR = 24,
    padT = 24,
    padB = 36
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const has2 = !!color2 && points[0].val2 !== undefined
  const vals = points.flatMap((p) => (has2 ? [p.val, p.val2 as number] : [p.val]))
  const min = Math.min(0, ...vals)
  const max = Math.max(0, ...vals)
  const ticks = niceTicks(min, max, 4)
  const tMin = ticks[0],
    tMax = ticks[ticks.length - 1]
  const tRange = tMax - tMin || 1
  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0
  const xOf = (i: number) => padL + i * xStep
  const yOf = (v: number) => padT + innerH - ((v - tMin) / tRange) * innerH
  const yZero = yOf(0)

  const primPts: [number, number][] = points.map((p, i) => [xOf(i), yOf(p.val)])
  const primPath = smoothPath(primPts)
  const areaPath = `${primPath} L${xOf(points.length - 1).toFixed(1)},${yZero.toFixed(1)} L${padL.toFixed(1)},${yZero.toFixed(1)} Z`
  const secPath = has2 ? smoothPath(points.map((p, i) => [xOf(i), yOf(p.val2 as number)])) : ''

  const gradId = 'gradPrim_' + Math.random().toString(36).slice(2, 7)
  const yTicks = ticks
    .map(
      (t) => `
    <line x1="${padL}" y1="${yOf(t).toFixed(1)}" x2="${(w - padR).toFixed(1)}" y2="${yOf(t).toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
    <text x="${(padL - 12).toFixed(1)}" y="${(yOf(t) + 3.5).toFixed(1)}" text-anchor="end" fill="var(--text-tertiary)" font-size="10.5" font-family="-apple-system" font-weight="500">${moneyShort(t)}</text>
  `,
    )
    .join('')
  const xLabels = points
    .map(
      (p, i) =>
        `<text x="${xOf(i).toFixed(1)}" y="${(h - 10).toFixed(1)}" text-anchor="middle" fill="var(--text-tertiary)" font-size="11" font-family="-apple-system" font-weight="500">${fmtMonthShort(p.id)}</text>`,
    )
    .join('')

  const lastI = points.length - 1
  const lastP = points[lastI]
  const lastX = xOf(lastI)
  const lastY = yOf(lastP.val)
  const lastY2 = has2 ? yOf(lastP.val2 as number) : null

  const hoverCols = points
    .map((p, i) => {
      const x = xOf(i)
      const left = i === 0 ? padL : x - xStep / 2
      const right = i === lastI ? w - padR : x + xStep / 2
      const bandW = Math.max(1, right - left)
      const rows = [{ label: labelP, value: money(p.val), color }]
      if (has2) rows.push({ label: labelS, value: money(p.val2 as number), color: color2 as string })
      const tip = tipAttr(tipMarkup(fmtMonth(p.id), rows))
      return `<g class="ct-col">
      <line class="ct-guide" x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(padT + innerH).toFixed(1)}" />
      ${has2 ? `<circle class="ct-dot" cx="${x.toFixed(1)}" cy="${yOf(p.val2 as number).toFixed(1)}" r="4" style="--c:${color2}" />` : ''}
      <circle class="ct-dot" cx="${x.toFixed(1)}" cy="${yOf(p.val).toFixed(1)}" r="4" style="--c:${color}" />
      <rect class="ct-hit" x="${left.toFixed(1)}" y="${padT}" width="${bandW.toFixed(1)}" height="${innerH}" fill="transparent" pointer-events="all" ${tip} />
    </g>`
    })
    .join('')

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:240px;overflow:visible">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
        <stop offset="60%" stop-color="${color}" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${yTicks}
    <path d="${areaPath}" fill="url(#${gradId})" />
    <path d="${primPath}" stroke="${color}" stroke-width="2.25" fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 2px 4px ${color}40)" />
    ${has2 ? `<path d="${secPath}" stroke="${color2}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0" opacity="0.95" />` : ''}
    ${has2 ? `<circle cx="${lastX.toFixed(1)}" cy="${(lastY2 as number).toFixed(1)}" r="5" fill="var(--bg)" stroke="${color2}" stroke-width="2" />` : ''}
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="5" fill="var(--bg)" stroke="${color}" stroke-width="2" />
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="11" fill="${color}" fill-opacity="0.15" />
    ${xLabels}
    ${hoverCols}
  </svg>`
}

export interface DailyGroup {
  total: number
  byCat: Record<string, number>
}

export function renderDailyChart(
  keys: string[],
  groups: Record<string, DailyGroup>,
  _bucket: string,
  bucketLabel: (k: string) => string,
): string {
  if (!keys.length) return ''
  const w = 900,
    h = 260
  const padL = 56,
    padR = 16,
    padT = 16,
    padB = 40
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const max = Math.max(...keys.map((k) => groups[k].total)) || 1
  const ticks = niceTicks(0, max, 4)
  const tMax = ticks[ticks.length - 1] || 1
  const colWidth = innerW / keys.length
  const barW = Math.max(8, Math.min(colWidth - 10, 44))
  const radius = Math.min(4, barW / 2)
  const colors: Record<string, string> = {
    'Base Software': '#5e9eff',
    'LinkedIn Channel': '#bf5af2',
    'Email Channel': '#64d2ff',
    SMS: '#ff9f0a',
    'One off': '#ff9500',
  }
  const yOf = (v: number) => padT + innerH - (v / tMax) * innerH

  const bars = keys
    .map((k, i) => {
      const g = groups[k]
      if (g.total === 0) return ''
      const xCenter = padL + i * colWidth + colWidth / 2
      const x = xCenter - barW / 2
      const totalH = (g.total / tMax) * innerH
      const topY = padT + innerH - totalH
      const clipId = `clip_${i}`
      const r = Math.min(radius, totalH / 2)
      const clipPath = `M${x},${(topY + r).toFixed(1)} Q${x},${topY.toFixed(1)} ${(x + r).toFixed(1)},${topY.toFixed(1)} L${(x + barW - r).toFixed(1)},${topY.toFixed(1)} Q${(x + barW).toFixed(1)},${topY.toFixed(1)} ${(x + barW).toFixed(1)},${(topY + r).toFixed(1)} L${(x + barW).toFixed(1)},${(padT + innerH).toFixed(1)} L${x},${(padT + innerH).toFixed(1)} Z`
      let yAcc = padT + innerH
      const segments = CATEGORY_ORDER.map((cat) => {
        const v = g.byCat[cat] || 0
        if (v === 0) return ''
        const hSeg = (v / tMax) * innerH
        yAcc -= hSeg
        return `<rect class="ct-seg" x="${x.toFixed(1)}" y="${yAcc.toFixed(1)}" width="${barW.toFixed(1)}" height="${hSeg.toFixed(1)}" fill="${colors[cat]}" clip-path="url(#${clipId})" />`
      }).join('')
      const catRows = Object.entries(g.byCat)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, v]) => ({ label: cat, value: money(v), color: colors[cat] }))
      const tip = tipAttr(tipMarkup(bucketLabel(k), [...catRows, { label: 'Total', value: money(g.total) }]))
      const hit = `<rect class="ct-hit" x="${(padL + i * colWidth).toFixed(1)}" y="${padT}" width="${colWidth.toFixed(1)}" height="${innerH}" fill="transparent" pointer-events="all" ${tip} />`
      return `<g class="ct-col"><defs><clipPath id="${clipId}"><path d="${clipPath}" /></clipPath></defs>${segments}${hit}</g>`
    })
    .join('')

  const yTicks = ticks
    .map((t) => {
      const y = yOf(t)
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(w - padR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
            <text x="${(padL - 12).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="var(--text-tertiary)" font-size="10.5" font-family="-apple-system" font-weight="500">${moneyShort(t)}</text>`
    })
    .join('')

  const labelStep = Math.max(1, Math.ceil(keys.length / 9))
  const xLabels = keys
    .map((k, i) =>
      i % labelStep === 0
        ? `<text x="${(padL + i * colWidth + colWidth / 2).toFixed(1)}" y="${(h - 12).toFixed(1)}" text-anchor="middle" fill="var(--text-tertiary)" font-size="10.5" font-family="-apple-system" font-weight="500">${bucketLabel(k).replace('Week of ', '')}</text>`
        : '',
    )
    .join('')

  const legend = CATEGORY_ORDER.map(
    (cat) =>
      `<span style="font-size:11px;color:var(--text-secondary);display:inline-flex;align-items:center;gap:6px;margin-right:18px;letter-spacing:-0.005em"><span style="width:10px;height:10px;background:${colors[cat] || 'var(--text-tertiary)'};border-radius:3px;display:inline-block"></span>${cat}</span>`,
  ).join('')

  return `<div>
    <div style="margin-bottom:14px">${legend}</div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:280px;overflow:visible">
      ${yTicks}
      ${bars}
      ${xLabels}
    </svg>
  </div>`
}

export interface MultiPoint {
  id: string
  rev: number
  exp: number
  net: number
}

export function renderMultiTrendChart(points: MultiPoint[], splitIdx: number): string {
  if (!points.length) return ''
  const w = 800,
    h = 260
  const padL = 56,
    padR = 24,
    padT = 24,
    padB = 36
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const allVals = points.flatMap((p) => [p.rev, p.exp, p.net])
  const min = Math.min(0, ...allVals)
  const max = Math.max(0, ...allVals)
  const ticks = niceTicks(min, max, 4)
  const tMin = ticks[0],
    tMax = ticks[ticks.length - 1]
  const tRange = tMax - tMin || 1
  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0
  const xOf = (i: number) => padL + i * xStep
  const yOf = (v: number) => padT + innerH - ((v - tMin) / tRange) * innerH

  function ptsFor(key: keyof MultiPoint, from: number, to: number): [number, number][] {
    return points.slice(from, to).map((p, i) => [xOf(from + i), yOf(p[key] as number)])
  }

  const series: { key: keyof MultiPoint; color: string }[] = [
    { key: 'rev', color: 'var(--accent)' },
    { key: 'exp', color: 'var(--bad)' },
    { key: 'net', color: 'var(--good)' },
  ]

  const yTicks = ticks
    .map(
      (t) => `
    <line x1="${padL}" y1="${yOf(t).toFixed(1)}" x2="${(w - padR).toFixed(1)}" y2="${yOf(t).toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
    <text x="${(padL - 12).toFixed(1)}" y="${(yOf(t) + 3.5).toFixed(1)}" text-anchor="end" fill="var(--text-tertiary)" font-size="10.5" font-family="-apple-system" font-weight="500">${moneyShort(t)}</text>
  `,
    )
    .join('')

  const xLabels = points
    .map(
      (p, i) =>
        `<text x="${xOf(i).toFixed(1)}" y="${(h - 10).toFixed(1)}" text-anchor="middle" fill="${i < splitIdx ? 'var(--text-tertiary)' : 'var(--text-quaternary)'}" font-size="11" font-family="-apple-system" font-weight="500">${fmtMonthShort(p.id)}</text>`,
    )
    .join('')

  const splitX = splitIdx > 0 && splitIdx < points.length ? padL + (splitIdx - 0.5) * xStep : null

  const seriesMeta: { key: keyof MultiPoint; label: string; color: string }[] = [
    { key: 'rev', label: 'Revenue', color: 'var(--accent)' },
    { key: 'exp', label: 'Expenses', color: 'var(--bad)' },
    { key: 'net', label: 'Net profit', color: 'var(--good)' },
  ]
  const lastI = points.length - 1
  const hoverCols = points
    .map((p, i) => {
      const x = xOf(i)
      const left = i === 0 ? padL : x - xStep / 2
      const right = i === lastI ? w - padR : x + xStep / 2
      const bandW = Math.max(1, right - left)
      const projected = i >= splitIdx
      const title = `${fmtMonth(p.id)}${projected ? ' · projected' : ''}`
      const tip = tipAttr(
        tipMarkup(
          title,
          seriesMeta.map((s) => ({ label: s.label, value: money(p[s.key] as number), color: s.color })),
        ),
      )
      const dots = seriesMeta
        .map((s) => `<circle class="ct-dot" cx="${x.toFixed(1)}" cy="${yOf(p[s.key] as number).toFixed(1)}" r="4" style="--c:${s.color}" />`)
        .join('')
      return `<g class="ct-col">
      <line class="ct-guide" x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(padT + innerH).toFixed(1)}" />
      ${dots}
      <rect class="ct-hit" x="${left.toFixed(1)}" y="${padT}" width="${bandW.toFixed(1)}" height="${innerH}" fill="transparent" pointer-events="all" ${tip} />
    </g>`
    })
    .join('')

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:280px;overflow:visible">
    ${yTicks}
    ${
      splitX !== null
        ? `<line x1="${splitX.toFixed(1)}" y1="${padT}" x2="${splitX.toFixed(1)}" y2="${(padT + innerH).toFixed(1)}" stroke="rgba(255,255,255,0.10)" stroke-width="1" />
       <text x="${splitX.toFixed(1)}" y="${(padT - 8).toFixed(1)}" text-anchor="middle" fill="var(--text-tertiary)" font-size="9" font-family="-apple-system" letter-spacing="0.08em" font-weight="600">PROJECTION ↓</text>`
        : ''
    }
    ${series
      .map((s) => {
        const realPts = ptsFor(s.key, 0, splitIdx)
        const projPts = ptsFor(s.key, Math.max(0, splitIdx - 1), points.length)
        return `<path d="${smoothPath(realPts)}" stroke="${s.color}" stroke-width="2.25" fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 1px 3px ${s.color === 'var(--accent)' ? 'rgba(212,160,23,0.3)' : s.color === 'var(--bad)' ? 'rgba(255,69,58,0.25)' : 'rgba(48,209,88,0.25)'})" />
              <path d="${smoothPath(projPts)}" stroke="${s.color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4,5" opacity="0.65" />`
      })
      .join('')}
    ${xLabels}
    ${hoverCols}
  </svg>`
}
