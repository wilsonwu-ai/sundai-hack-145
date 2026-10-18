// FROZEN presets: the 2035 package and the workloads every result is quoted on.
// Numbers are order-of-magnitude projections, sourced in research/brief.md.

import type { Chiplet, ChipletKind, Layout, PackageSpec, Workload } from '../contracts'

export const PKG: PackageSpec = {
  W: 60,
  H: 60,
  nx: 48,
  ny: 48,
  ktEff: 0.9,
  hEff: 20000,
  tAmb: 35,
  minGap: 1,
}

/** Base power per kind, W, before the workload factor. */
export const BASE_POWER: Record<ChipletKind, number> = {
  compute: 300,
  hbm: 30,
  io: 40,
}

export const WORKLOADS: Workload[] = [
  {
    id: 'training',
    label: 'Training',
    blurb: 'Matrix math flat out. Compute dies run hot, memory is busy but not maxed.',
    factor: { compute: 1.0, hbm: 1.0, io: 1.0 },
  },
  {
    id: 'prefill',
    label: 'Inference: prefill',
    blurb: 'Reading a long prompt in one go. Compute-bound, a little lighter than training.',
    factor: { compute: 0.85, hbm: 0.8, io: 0.9 },
  },
  {
    id: 'decode',
    label: 'Inference: decode',
    blurb: 'Writing the answer one token at a time. Memory-bound: HBM works hardest, compute idles.',
    factor: { compute: 0.45, hbm: 1.6, io: 1.2 },
  },
]

const shape: Record<ChipletKind, { w: number; h: number }> = {
  compute: { w: 14, h: 14 },
  hbm: { w: 8, h: 11 },
  io: { w: 20, h: 10 },
}

function chip(id: string, kind: ChipletKind, x: number, y: number): Chiplet {
  return { id, kind, ...shape[kind], x, y, powerW: BASE_POWER[kind] }
}

/**
 * The "obvious" starting layout: compute dies packed in a tight 2×2 block in the
 * middle (shortest wires), HBM on the sides, IO die at the bottom. It is what a
 * wire-length-first floorplan looks like, and it is hot.
 */
export function defaultLayout(): Layout {
  const cx = 30
  const cy = 26
  return {
    pkg: { ...PKG },
    chiplets: [
      chip('C0', 'compute', cx - 14.5, cy - 14.5),
      chip('C1', 'compute', cx + 0.5, cy - 14.5),
      chip('C2', 'compute', cx - 14.5, cy + 0.5),
      chip('C3', 'compute', cx + 0.5, cy + 0.5),
      chip('M0', 'hbm', cx - 24, cy - 11.5),
      chip('M1', 'hbm', cx - 24, cy + 0.5),
      chip('M2', 'hbm', cx + 16, cy - 11.5),
      chip('M3', 'hbm', cx + 16, cy + 0.5),
      chip('IO', 'io', cx - 10, cy + 18),
    ],
  }
}

/** Same geometry, powers scaled for the workload. */
export function applyWorkload(layout: Layout, w: Workload): Layout {
  return {
    pkg: layout.pkg,
    chiplets: layout.chiplets.map((c) => ({ ...c, powerW: BASE_POWER[c.kind] * w.factor[c.kind] })),
  }
}

export const cloneLayout = (l: Layout): Layout => ({
  pkg: { ...l.pkg },
  chiplets: l.chiplets.map((c) => ({ ...c })),
})
