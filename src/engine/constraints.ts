// FROZEN. Legality = geometry (solver.validate) + a wire budget.
//
// Without a wire budget the "coolest" layout is trivial: fling the hot dies into
// the corners. Real packages can't, because die-to-die and die-to-HBM links get
// slower and hungrier with distance. So every layout must keep its total link
// length (centre to centre, Manhattan) within WIRE_SLACK × the default layout's.

import type { Layout } from '../contracts'
import { validate } from './solver'
import { defaultLayout } from './presets'

/** Which chiplets talk to which. Compute dies in a ring, each with its own HBM, all to IO. */
export const LINKS: [string, string][] = [
  ['C0', 'C1'],
  ['C1', 'C3'],
  ['C3', 'C2'],
  ['C2', 'C0'],
  ['C0', 'M0'],
  ['C2', 'M1'],
  ['C1', 'M2'],
  ['C3', 'M3'],
  ['C0', 'IO'],
  ['C1', 'IO'],
  ['C2', 'IO'],
  ['C3', 'IO'],
]

/** Allowed wire length relative to the default floorplan. */
export const WIRE_SLACK = 1.3

export function wireLength(layout: Layout): number {
  const byId = new Map(layout.chiplets.map((c) => [c.id, c]))
  let s = 0
  for (const [a, b] of LINKS) {
    const p = byId.get(a)
    const q = byId.get(b)
    if (!p || !q) continue
    s += Math.abs(p.x + p.w / 2 - (q.x + q.w / 2)) + Math.abs(p.y + p.h / 2 - (q.y + q.h / 2))
  }
  return s
}

export const WIRE_BUDGET = WIRE_SLACK * wireLength(defaultLayout())

/** null if legal, else the reason. Every layout the optimizer reports must pass. */
export function checkLegal(layout: Layout): string | null {
  const g = validate(layout)
  if (g) return g
  const wl = wireLength(layout)
  if (wl > WIRE_BUDGET + 1e-9) {
    return `wire length ${wl.toFixed(1)} mm exceeds budget ${WIRE_BUDGET.toFixed(1)} mm`
  }
  return null
}
