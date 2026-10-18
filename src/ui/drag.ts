import type { Layout } from '../contracts'
import type { HeatMap } from './heatmap'

export interface DragHandlers {
  getLayout(): Layout
  enabled(): boolean
  /** new top-left position in mm, already clamped to the interposer */
  onMove(id: string, x: number, y: number): void
  onEnd(): void
  onGrab(id: string | null): void
}

/** Pointer-events drag (mouse, touch, pen) for chiplets on the heat map canvas. */
export function attachDrag(map: HeatMap, h: DragHandlers): void {
  const canvas = map.canvas
  let active: { id: string; dx: number; dy: number; pid: number } | null = null

  canvas.addEventListener('pointerdown', (e) => {
    if (!h.enabled()) return
    const layout = h.getLayout()
    const id = map.hit(e.clientX, e.clientY, layout)
    if (!id) return
    const c = layout.chiplets.find((k) => k.id === id)
    if (!c) return
    const p = map.toMm(e.clientX, e.clientY, layout)
    active = { id, dx: p.x - c.x, dy: p.y - c.y, pid: e.pointerId }
    canvas.setPointerCapture(e.pointerId)
    canvas.style.cursor = 'grabbing'
    h.onGrab(id)
    e.preventDefault()
  })

  canvas.addEventListener('pointermove', (e) => {
    const layout = h.getLayout()
    if (!active) {
      if (h.enabled()) canvas.style.cursor = map.hit(e.clientX, e.clientY, layout) ? 'grab' : 'default'
      return
    }
    if (e.pointerId !== active.pid) return
    const c = layout.chiplets.find((k) => k.id === active!.id)
    if (!c) return
    const p = map.toMm(e.clientX, e.clientY, layout)
    const x = Math.min(layout.pkg.W - c.w, Math.max(0, p.x - active.dx))
    const y = Math.min(layout.pkg.H - c.h, Math.max(0, p.y - active.dy))
    h.onMove(active.id, x, y)
  })

  const end = (e: PointerEvent): void => {
    if (!active || e.pointerId !== active.pid) return
    active = null
    canvas.style.cursor = 'grab'
    h.onGrab(null)
    h.onEnd()
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
}
