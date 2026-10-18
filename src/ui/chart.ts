export interface Series {
  label: string
  /** any CSS colour, may be var(--x) */
  color: string
  pts: { x: number; y: number }[]
}

const VW = 420
const VH = 220
const M = { l: 44, r: 12, t: 12, b: 34 }

/** Best-verified-peak-so-far step chart, drawn as inline SVG. */
export function renderChart(svg: SVGSVGElement, series: Series[], xMax: number): void {
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`)
  const all = series.flatMap((s) => s.pts.map((p) => p.y))
  let lo = all.length ? Math.min(...all) : 60
  let hi = all.length ? Math.max(...all) : 100
  lo = Math.floor(lo - 1)
  hi = Math.ceil(hi + 1)
  if (hi - lo < 4) hi = lo + 4
  const X = (v: number): number => M.l + (Math.min(v, xMax) / xMax) * (VW - M.l - M.r)
  const Y = (v: number): number => M.t + ((hi - v) / (hi - lo)) * (VH - M.t - M.b)

  let out = ''
  const yTicks = 4
  for (let i = 0; i <= yTicks; i++) {
    const v = lo + ((hi - lo) * i) / yTicks
    out += `<line x1="${M.l}" x2="${VW - M.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/>`
    out += `<text x="${M.l - 6}" y="${Y(v) + 3}" text-anchor="end" class="tick">${v.toFixed(0)}</text>`
  }
  for (let i = 0; i <= 5; i++) {
    const v = (xMax * i) / 5
    out += `<text x="${X(v)}" y="${VH - M.b + 14}" text-anchor="middle" class="tick">${v.toFixed(0)}</text>`
  }
  out += `<text x="${(VW + M.l) / 2}" y="${VH - 4}" text-anchor="middle" class="axis">full-solver calls</text>`
  out += `<text x="10" y="${(VH - M.b) / 2}" text-anchor="middle" class="axis" transform="rotate(-90 10 ${(VH - M.b) / 2})">best verified peak °C</text>`

  for (const s of series) {
    if (!s.pts.length) continue
    let d = `M${X(s.pts[0].x).toFixed(1)} ${Y(s.pts[0].y).toFixed(1)}`
    for (let i = 1; i < s.pts.length; i++) {
      d += ` H${X(s.pts[i].x).toFixed(1)} V${Y(s.pts[i].y).toFixed(1)}`
    }
    out += `<path d="${d}" class="line" style="stroke:${s.color}"/>`
    const last = s.pts[s.pts.length - 1]
    out += `<circle cx="${X(last.x)}" cy="${Y(last.y)}" r="3.5" style="fill:${s.color}"/>`
  }
  svg.innerHTML = out
}
