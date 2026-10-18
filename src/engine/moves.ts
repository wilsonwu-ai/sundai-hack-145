// Moves on a floorplan. Only x, y change (and, as a real move, positions of two
// same-kind chiplets may swap: same thermal field, different wire lengths).

import type { ChipletKind, Layout } from '../contracts'
import { checkLegal } from './constraints'
import { cloneLayout } from './presets'
import { gauss } from './rng'

/**
 * One random move, or null if 20 attempts all produced an illegal layout.
 * Moves 1-2 chiplets by a Gaussian step (std = scaleMm), clamped to the
 * interposer; about 8% of the time swaps two same-kind chiplets instead.
 */
export function tryPerturb(layout: Layout, rng: () => number, scaleMm: number): Layout | null {
  const n = layout.chiplets.length
  if (n === 0) return null
  const { W, H } = layout.pkg
  for (let attempt = 0; attempt < 20; attempt++) {
    const next = cloneLayout(layout)
    if (rng() < 0.08) {
      const i = Math.floor(rng() * n)
      const mates: number[] = []
      for (let k = 0; k < n; k++) {
        if (k !== i && next.chiplets[k].kind === next.chiplets[i].kind) mates.push(k)
      }
      if (mates.length === 0) continue
      const j = mates[Math.floor(rng() * mates.length)]
      const a = next.chiplets[i]
      const b = next.chiplets[j]
      const tx = a.x
      const ty = a.y
      a.x = b.x
      a.y = b.y
      b.x = tx
      b.y = ty
    } else {
      const moves = rng() < 0.3 ? 2 : 1
      for (let m = 0; m < moves; m++) {
        const c = next.chiplets[Math.floor(rng() * n)]
        c.x = Math.min(Math.max(c.x + gauss(rng) * scaleMm, 0), W - c.w)
        c.y = Math.min(Math.max(c.y + gauss(rng) * scaleMm, 0), H - c.h)
      }
    }
    if (checkLegal(next) === null) return next
  }
  return null
}

/** A NEW legal layout, or a clone of the input if no legal move was found. */
export function perturb(layout: Layout, rng: () => number, scaleMm: number): Layout {
  return tryPerturb(layout, rng, scaleMm) ?? cloneLayout(layout)
}

/** A diverse legal layout: a long large-step random walk of legal moves from base. */
export function randomLegalLayout(base: Layout, rng: () => number): Layout {
  let cur = cloneLayout(base)
  for (let s = 0; s < 40; s++) {
    const next = tryPerturb(cur, rng, 4 + rng() * 10)
    if (next) cur = next
  }
  return cur
}

const KINDS: ChipletKind[] = ['compute', 'hbm', 'io']

/**
 * Total Manhattan displacement between two layouts, matching chiplets of the
 * same kind by sorted position so that swapping two identical dies counts as
 * zero (it changes nothing thermally).
 */
export function layoutDistance(a: Layout, b: Layout): number {
  let s = 0
  for (const kind of KINDS) {
    const pa = a.chiplets.filter((c) => c.kind === kind).map((c) => [c.x, c.y])
    const pb = b.chiplets.filter((c) => c.kind === kind).map((c) => [c.x, c.y])
    if (pa.length !== pb.length) return Infinity
    const cmp = (p: number[], q: number[]) => p[0] - q[0] || p[1] - q[1]
    pa.sort(cmp)
    pb.sort(cmp)
    for (let i = 0; i < pa.length; i++) {
      s += Math.abs(pa[i][0] - pb[i][0]) + Math.abs(pa[i][1] - pb[i][1])
    }
  }
  return s
}
