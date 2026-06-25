// Pure SVG chart helpers — ported verbatim from the legacy app.

// Catmull-Rom → cubic Bezier smoothing for line charts.
export function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return points.length === 1 ? `M${points[0][0]},${points[0][1]}` : ''
  if (points.length === 2) return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`
  const tension = 0.4
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const cp1x = p1[0] + ((p2[0] - p0[0]) * tension) / 2
    const cp1y = p1[1] + ((p2[1] - p0[1]) * tension) / 2
    const cp2x = p2[0] - ((p3[0] - p1[0]) * tension) / 2
    const cp2y = p2[1] - ((p3[1] - p1[1]) * tension) / 2
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

// Generate 3–5 round "nice" tick values across [min, max].
export function niceTicks(min: number, max: number, targetCount?: number): number[] {
  if (min === max) {
    max = min + 1
  }
  const range = max - min
  const rawStep = range / (targetCount || 4)
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step * 0.0001; v += step) ticks.push(v)
  return ticks
}
