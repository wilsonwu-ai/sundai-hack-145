// FROZEN. The full thermal solver is the ground truth every claim is checked
// against. No optimizer, surrogate or UI change may edit it.
//
// Model: a 2D heat-spreading plate (die + lid lumped into k·t) cooled from above
// by a cold plate with coefficient h. Per unit area, at steady state:
//
//   k·t ∇²T − h (T − T_amb) + q(x, y) = 0,   adiabatic side edges
//
// Finite volumes on an nx × ny grid give a symmetric positive-definite system,
// solved with Jacobi-preconditioned conjugate gradients.

import type { Chiplet, Layout, PackageSpec, SolveResult } from '../contracts'

/** Power per cell (W), spreading each chiplet over the cells it overlaps by area. */
export function rasterize(layout: Layout): Float64Array {
  const { pkg, chiplets } = layout
  const { nx, ny } = pkg
  const dx = pkg.W / nx
  const dy = pkg.H / ny
  const p = new Float64Array(nx * ny)
  for (const c of chiplets) {
    const area = c.w * c.h
    if (area <= 0 || c.powerW === 0) continue
    const i0 = Math.max(0, Math.floor(c.x / dx))
    const i1 = Math.min(nx - 1, Math.floor((c.x + c.w) / dx))
    const j0 = Math.max(0, Math.floor(c.y / dy))
    const j1 = Math.min(ny - 1, Math.floor((c.y + c.h) / dy))
    for (let j = j0; j <= j1; j++) {
      const oy = Math.min((j + 1) * dy, c.y + c.h) - Math.max(j * dy, c.y)
      if (oy <= 0) continue
      for (let i = i0; i <= i1; i++) {
        const ox = Math.min((i + 1) * dx, c.x + c.w) - Math.max(i * dx, c.x)
        if (ox <= 0) continue
        p[j * nx + i] += (c.powerW * ox * oy) / area
      }
    }
  }
  return p
}

export interface SolveOptions {
  tol?: number
  maxIter?: number
}

export function solve(layout: Layout, opts: SolveOptions = {}): SolveResult {
  const { pkg } = layout
  const { nx, ny, ktEff, hEff, tAmb } = pkg
  const tol = opts.tol ?? 1e-9
  const maxIter = opts.maxIter ?? 4 * nx * ny
  const dx = pkg.W / nx / 1000 // m
  const dy = pkg.H / ny / 1000
  const gx = (ktEff * dy) / dx // W/K between horizontal neighbours
  const gy = (ktEff * dx) / dy
  const gh = hEff * dx * dy // W/K to coolant
  const n = nx * ny
  const b = rasterize(layout)

  const diag = new Float64Array(n)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let d = gh
      if (i > 0) d += gx
      if (i < nx - 1) d += gx
      if (j > 0) d += gy
      if (j < ny - 1) d += gy
      diag[j * nx + i] = d
    }
  }

  const applyA = (v: Float64Array, out: Float64Array) => {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        let s = diag[k] * v[k]
        if (i > 0) s -= gx * v[k - 1]
        if (i < nx - 1) s -= gx * v[k + 1]
        if (j > 0) s -= gy * v[k - nx]
        if (j < ny - 1) s -= gy * v[k + nx]
        out[k] = s
      }
    }
  }

  // Unknown is the temperature rise θ = T − T_amb; start from the local-only guess.
  const x = new Float64Array(n)
  for (let k = 0; k < n; k++) x[k] = b[k] / diag[k]
  const r = new Float64Array(n)
  const z = new Float64Array(n)
  const pv = new Float64Array(n)
  const Ap = new Float64Array(n)
  applyA(x, Ap)
  let bNorm = 0
  for (let k = 0; k < n; k++) {
    r[k] = b[k] - Ap[k]
    bNorm += b[k] * b[k]
  }
  bNorm = Math.sqrt(bNorm) || 1
  let rz = 0
  for (let k = 0; k < n; k++) {
    z[k] = r[k] / diag[k]
    pv[k] = z[k]
    rz += r[k] * z[k]
  }
  let iter = 0
  let res = 0
  for (; iter < maxIter; iter++) {
    let rr = 0
    for (let k = 0; k < n; k++) rr += r[k] * r[k]
    res = Math.sqrt(rr) / bNorm
    if (res < tol) break
    applyA(pv, Ap)
    let pAp = 0
    for (let k = 0; k < n; k++) pAp += pv[k] * Ap[k]
    const alpha = rz / pAp
    for (let k = 0; k < n; k++) {
      x[k] += alpha * pv[k]
      r[k] -= alpha * Ap[k]
    }
    let rzNew = 0
    for (let k = 0; k < n; k++) {
      z[k] = r[k] / diag[k]
      rzNew += r[k] * z[k]
    }
    const beta = rzNew / rz
    rz = rzNew
    for (let k = 0; k < n; k++) pv[k] = z[k] + beta * pv[k]
  }

  const grid = new Float64Array(n)
  let tMax = -Infinity
  let hot = 0
  let sum = 0
  for (let k = 0; k < n; k++) {
    const t = tAmb + x[k]
    grid[k] = t
    sum += t
    if (t > tMax) {
      tMax = t
      hot = k
    }
  }
  return {
    grid,
    nx,
    ny,
    tMax,
    tMean: sum / n,
    hotI: hot % nx,
    hotJ: Math.floor(hot / nx),
    iterations: iter,
    residual: res,
  }
}

/** Heat leaving through the cold plate, W. Equals total power at steady state. */
export function heatOut(pkg: PackageSpec, grid: Float64Array): number {
  const gh = pkg.hEff * (pkg.W / pkg.nx / 1000) * (pkg.H / pkg.ny / 1000)
  let s = 0
  for (let k = 0; k < grid.length; k++) s += gh * (grid[k] - pkg.tAmb)
  return s
}

/** null if the layout is legal, else the reason. */
export function validate(layout: Layout): string | null {
  const { pkg, chiplets } = layout
  const eps = 1e-9
  for (const c of chiplets) {
    if (c.x < -eps || c.y < -eps || c.x + c.w > pkg.W + eps || c.y + c.h > pkg.H + eps) {
      return `${c.id} is off the interposer`
    }
  }
  for (let a = 0; a < chiplets.length; a++) {
    for (let b = a + 1; b < chiplets.length; b++) {
      if (tooClose(chiplets[a], chiplets[b], pkg.minGap - eps)) {
        return `${chiplets[a].id} and ${chiplets[b].id} overlap or are closer than ${pkg.minGap} mm`
      }
    }
  }
  return null
}

function tooClose(a: Chiplet, b: Chiplet, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap &&
    b.x < a.x + a.w + gap &&
    a.y < b.y + b.h + gap &&
    b.y < a.y + a.h + gap
  )
}

export const totalPower = (layout: Layout) =>
  layout.chiplets.reduce((s, c) => s + c.powerW, 0)
