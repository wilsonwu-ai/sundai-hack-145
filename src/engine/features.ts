// Physics-informed features for the surrogate.
//
// Steady conduction here is linear in power: the rise at a point is
//   θ(p) = Σ_j P_j · G(p, c_j),  G(r) = K0(r / L) / (2π·kt),  L = sqrt(kt / h),
// with adiabatic edges handled by mirror images of every source. We evaluate that
// estimate at five points of every chiplet and summarise it permutation-invariantly.

import type { Layout } from '../contracts'

export const N_FEATURES = 15

/** Modified Bessel K0 (Abramowitz & Stegun 9.8.5 / 9.8.6), x > 0. */
function k0(x: number): number {
  if (x <= 2) {
    const t = (x / 3.75) * (x / 3.75)
    const i0 =
      1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813)))))
    const y = (x * x) / 4
    return (
      -Math.log(x / 2) * i0 +
      (-0.57721566 +
        y * (0.4227842 + y * (0.23069756 + y * (0.0348859 + y * (0.00262698 + y * (0.0001075 + y * 0.0000074))))))
    )
  }
  const z = 2 / x
  return (
    (Math.exp(-x) / Math.sqrt(x)) *
    (1.25331414 +
      z * (-0.07832358 + z * (0.02189568 + z * (-0.01062446 + z * (0.00587872 + z * (-0.0025154 + z * 0.00053208))))))
  )
}

const KIND_INDEX = { compute: 0, hbm: 1, io: 2 } as const

export function features(layout: Layout): Float64Array {
  const { pkg, chiplets } = layout
  const n = chiplets.length
  const out = new Float64Array(N_FEATURES)
  if (n === 0) return out
  const L = Math.sqrt(pkg.ktEff / pkg.hEff) * 1000 // mm
  const norm = 1 / (2 * Math.PI * pkg.ktEff)

  // Sources: every chiplet centre plus its mirror images across the nearer edge in x and/or y.
  const m = n * 4
  const sx = new Float64Array(m)
  const sy = new Float64Array(m)
  const sp = new Float64Array(m)
  const se = new Float64Array(m)
  const sid = new Int32Array(m)
  for (let j = 0; j < n; j++) {
    const c = chiplets[j]
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2
    const ix = cx < pkg.W / 2 ? -cx : 2 * pkg.W - cx
    const iy = cy < pkg.H / 2 ? -cy : 2 * pkg.H - cy
    const eps = 0.3 * Math.sqrt(c.w * c.h)
    const px = [cx, ix, cx, ix]
    const py = [cy, cy, iy, iy]
    for (let q = 0; q < 4; q++) {
      const k = j * 4 + q
      sx[k] = px[q]
      sy[k] = py[q]
      sp[k] = c.powerW * norm
      se[k] = eps
      sid[k] = j
    }
  }

  const rise = (px: number, py: number, ls: number, onlyId: number): number => {
    let s = 0
    for (let k = 0; k < m; k++) {
      if (onlyId >= 0 && sid[k] !== onlyId) continue
      const dx = px - sx[k]
      const dy = py - sy[k]
      s += sp[k] * k0(Math.sqrt(dx * dx + dy * dy + se[k] * se[k]) / ls)
    }
    return s
  }

  const cmax = new Float64Array(n)
  const ccent = new Float64Array(n)
  let best = -Infinity
  let bx = 0
  let by = 0
  let bid = 0
  for (let i = 0; i < n; i++) {
    const c = chiplets[i]
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2
    const qw = c.w / 4
    const qh = c.h / 4
    let mx = -Infinity
    for (let p = 0; p < 5; p++) {
      const px = p === 0 ? cx : cx + (p & 1 ? qw : -qw)
      const py = p === 0 ? cy : cy + (p & 2 ? qh : -qh)
      const r = rise(px, py, L, -1)
      if (p === 0) ccent[i] = r
      if (r > mx) mx = r
      if (r > best) {
        best = r
        bx = px
        by = py
        bid = i
      }
    }
    cmax[i] = mx
  }

  const sorted = Array.from(cmax).sort((a, b) => b - a)
  const top = (k: number) => sorted[Math.min(k, n - 1)]
  let meanCent = 0
  let p4 = 0
  const kindMax = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    meanCent += ccent[i] / n
    p4 += Math.pow(Math.max(cmax[i], 0), 4) / n
    const ki = KIND_INDEX[chiplets[i].kind]
    if (cmax[i] > kindMax[ki]) kindMax[ki] = cmax[i]
  }
  let totalP = 0
  for (const c of chiplets) totalP += c.powerW
  const self = rise(bx, by, L, bid)
  const edge = Math.min(bx, pkg.W - bx, by, pkg.H - by) / L

  out[0] = best
  out[1] = rise(bx, by, 0.6 * L, -1)
  out[2] = rise(bx, by, 1.6 * L, -1)
  out[3] = (best * best) / 100
  out[4] = top(0)
  out[5] = top(1)
  out[6] = top(2)
  out[7] = meanCent
  out[8] = Math.pow(p4, 0.25)
  out[9] = kindMax[0]
  out[10] = kindMax[1]
  out[11] = kindMax[2]
  out[12] = totalP / 100
  out[13] = best - self
  out[14] = edge
  return out
}
