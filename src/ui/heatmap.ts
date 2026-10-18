import type { ChipletKind, Layout, SolveResult } from '../contracts'
import { LINKS } from '../engine/constraints'

/** Fixed colour scale so "before" and "after" are directly comparable. */
export const T_MIN = 35
export const T_MAX = 95

const STOPS: [number, number, number][] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
]

export function colorAt(t: number): [number, number, number] {
  const f = Math.min(1, Math.max(0, (t - T_MIN) / (T_MAX - T_MIN)))
  const s = f * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(s))
  const u = s - i
  const a = STOPS[i]
  const b = STOPS[i + 1]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
}

/** CSS gradient for the colorbar, hot at the top. */
export function gradientCss(): string {
  const parts = STOPS.map((c, i) => `rgb(${c[0]},${c[1]},${c[2]}) ${((i / (STOPS.length - 1)) * 100).toFixed(1)}%`)
  return `linear-gradient(to top, ${parts.join(', ')})`
}

export interface DrawOptions {
  legal: boolean
  showLinks: boolean
  highlightId?: string | null
}

const KIND_STYLE: Record<ChipletKind, { stroke: string; dash: number[]; fill: string }> = {
  compute: { stroke: '#ffffff', dash: [], fill: 'rgba(0,0,0,0.18)' },
  hbm: { stroke: '#6ee7ff', dash: [5, 3], fill: 'rgba(0,30,40,0.28)' },
  io: { stroke: '#c4b5fd', dash: [2, 3], fill: 'rgba(20,10,40,0.28)' },
}

export class HeatMap {
  private ctx: CanvasRenderingContext2D
  private off: HTMLCanvasElement
  private last: { layout: Layout; res: SolveResult; opts: DrawOptions } | null = null
  private size = 0

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    this.ctx = ctx
    this.off = document.createElement('canvas')
  }

  /** Match the backing store to the CSS size. Returns true if it changed. */
  resize(): boolean {
    const css = Math.max(1, Math.round(this.canvas.clientWidth))
    const dpr = window.devicePixelRatio || 1
    const px = Math.round(css * dpr)
    if (px === this.size && this.canvas.width === px) return false
    this.size = px
    this.canvas.width = px
    this.canvas.height = px
    return true
  }

  redraw(): void {
    if (this.last) this.draw(this.last.layout, this.last.res, this.last.opts)
  }

  draw(layout: Layout, res: SolveResult, opts: DrawOptions): void {
    this.last = { layout, res, opts }
    this.resize()
    const { ctx, canvas } = this
    const S = canvas.width
    const { W, H } = layout.pkg
    const sx = S / W
    const sy = S / H

    // heat field: nx x ny texels, upscaled with bilinear smoothing
    const off = this.off
    if (off.width !== res.nx || off.height !== res.ny) {
      off.width = res.nx
      off.height = res.ny
    }
    const octx = off.getContext('2d')
    if (!octx) return
    const img = octx.createImageData(res.nx, res.ny)
    for (let k = 0; k < res.grid.length; k++) {
      const c = colorAt(res.grid[k])
      img.data[k * 4] = c[0]
      img.data[k * 4 + 1] = c[1]
      img.data[k * 4 + 2] = c[2]
      img.data[k * 4 + 3] = 255
    }
    octx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, S, S)
    ctx.drawImage(off, 0, 0, res.nx, res.ny, 0, 0, S, S)

    const lw = Math.max(1.5, S / 300)
    const byId = new Map(layout.chiplets.map((c) => [c.id, c]))

    if (opts.showLinks) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = Math.max(1, lw * 0.5)
      ctx.setLineDash([])
      for (const [a, b] of LINKS) {
        const p = byId.get(a)
        const q = byId.get(b)
        if (!p || !q) continue
        ctx.beginPath()
        ctx.moveTo((p.x + p.w / 2) * sx, (p.y + p.h / 2) * sy)
        ctx.lineTo((q.x + q.w / 2) * sx, (q.y + q.h / 2) * sy)
        ctx.stroke()
      }
      ctx.restore()
    }

    const font = Math.max(10, Math.round(S / 38))
    ctx.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const c of layout.chiplets) {
      const st = KIND_STYLE[c.kind]
      const x = c.x * sx
      const y = c.y * sy
      const w = c.w * sx
      const h = c.h * sy
      ctx.fillStyle = st.fill
      ctx.fillRect(x, y, w, h)
      ctx.lineWidth = c.id === opts.highlightId ? lw * 1.8 : lw
      ctx.strokeStyle = opts.legal ? st.stroke : '#ff4d4d'
      ctx.setLineDash(st.dash.map((d) => d * (S / 600)))
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 4
      ctx.fillText(c.id, x + w / 2, y + h / 2)
      ctx.shadowBlur = 0
    }

    // hottest cell marker
    const hx = ((res.hotI + 0.5) * W) / res.nx
    const hy = ((res.hotJ + 0.5) * H) / res.ny
    const px = hx * sx
    const py = hy * sy
    const r = Math.max(5, S / 90)
    ctx.lineWidth = lw
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(px - r * 1.6, py)
    ctx.lineTo(px + r * 1.6, py)
    ctx.moveTo(px, py - r * 1.6)
    ctx.lineTo(px, py + r * 1.6)
    ctx.stroke()
    const label = `${res.tMax.toFixed(1)} °C`
    ctx.font = `700 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`
    const tw = ctx.measureText(label).width + 10
    let lx = px + r * 2 + tw / 2
    if (lx + tw / 2 > S) lx = px - r * 2 - tw / 2
    let ly = py - r * 2.4
    if (ly - font < 0) ly = py + r * 2.4
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.fillRect(lx - tw / 2, ly - font * 0.75, tw, font * 1.5)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, lx, ly)
  }

  /** Client pixel position to package millimetres. */
  toMm(clientX: number, clientY: number, layout: Layout): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    return {
      x: ((clientX - r.left) / r.width) * layout.pkg.W,
      y: ((clientY - r.top) / r.height) * layout.pkg.H,
    }
  }

  hit(clientX: number, clientY: number, layout: Layout): string | null {
    const p = this.toMm(clientX, clientY, layout)
    for (let i = layout.chiplets.length - 1; i >= 0; i--) {
      const c = layout.chiplets[i]
      if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) return c.id
    }
    return null
  }
}
