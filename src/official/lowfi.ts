// Exact TypeScript port of scripts/official/lowfi.py (Model(h=1.0)).
// Steady-state thermal stack on a 1 mm grid, solved with Jacobi-preconditioned CG
// on a CSR matrix assembled here (no dependencies), warm-started across workloads.
import specJson from './data/spec.json'
import { spec, type Layout, type Routing } from './geometry'
import { combinedHeat } from './heat'

interface ThermalModel {
  ambient_c: number
  interposer_si_thickness_um: number
  die_si_thickness_um: number
  tim_thickness_um: number
  thermal_resistivity_si_mK_per_W: number
  thermal_resistivity_gap_mK_per_W: number
  thermal_resistivity_tim_mK_per_W: number
  cooling_contact_rect_mm: [number, number, number, number]
  outside_contact_resistivity_mK_per_W: number
  spreader_side_mm: number
  sink_side_mm: number
  cooling_resistance_K_per_W: number
}
export const thermalModel = (specJson as unknown as { thermal_model: ThermalModel }).thermal_model
const TM = thermalModel

const H = 1.0
const [W_MM, H_MM] = spec.interposer_mm
const K_SI = 1 / TM.thermal_resistivity_si_mK_per_W
const K_GAP = 1 / TM.thermal_resistivity_gap_mK_per_W
const K_TIM_IN = 1 / TM.thermal_resistivity_tim_mK_per_W
const K_TIM_OUT = 1 / TM.outside_contact_resistivity_mK_per_W
const K_CU = 400.0
const T_IP = TM.interposer_si_thickness_um * 1e-6
const T_DIE = TM.die_si_thickness_um * 1e-6
const T_TIM = TM.tim_thickness_um * 1e-6
const T_SPR = 1e-3
const T_SINK = 6.9e-3
const S_SPR = TM.spreader_side_mm
const S_SINK = TM.sink_side_mm
const R_CONV = TM.cooling_resistance_K_per_W
export const AMBIENT = TM.ambient_c

export const WORKLOAD_NAMES = Object.keys(spec.workloads)

const NX = Math.round(W_MM / H)
const NY = Math.round(H_MM / H)
const NS = Math.round(S_SINK / H)
const NC = NX * NY

/** Python round(): half to even. */
function roundEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}

const OX = roundEven((S_SINK - W_MM) / 2 / H)
const OY = roundEven((S_SINK - H_MM) / 2 / H)
const LO = roundEven((S_SINK - S_SPR) / 2 / H)
const NSPR_SIDE = roundEven(S_SPR / H)
const sprMask = new Uint8Array(NS * NS)
for (let j = LO; j < LO + NSPR_SIDE; j++) for (let i = LO; i < LO + NSPR_SIDE; i++) sprMask[j * NS + i] = 1
const sprIdx = new Int32Array(NS * NS).fill(-1)
let NSPR = 0
for (let k = 0; k < NS * NS; k++) if (sprMask[k]) sprIdx[k] = NSPR++

const xs0 = Float64Array.from({ length: NX }, (_, i) => i * H)
const ys0 = Float64Array.from({ length: NY }, (_, j) => j * H)

/** Fraction of each cell (row = y, col = x) covered by the union of disjoint boxes. */
function cover(boxes: [number, number, number, number][]): Float64Array {
  const f = new Float64Array(NC)
  const ox = new Float64Array(NX)
  const oy = new Float64Array(NY)
  for (const [x0, y0, x1, y1] of boxes) {
    for (let i = 0; i < NX; i++) ox[i] = Math.max(Math.min(xs0[i] + H, x1) - Math.max(xs0[i], x0), 0) / H
    for (let j = 0; j < NY; j++) oy[j] = Math.max(Math.min(ys0[j] + H, y1) - Math.max(ys0[j], y0), 0) / H
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) f[j * NX + i] += oy[j] * ox[i]
  }
  for (let k = 0; k < NC; k++) f[k] = Math.min(Math.max(f[k], 0), 1)
  return f
}

const kTim = (() => {
  const [cx, cy, cw, ch] = TM.cooling_contact_rect_mm
  const fc = cover([[cx, cy, cx + cw, cy + ch]])
  const k = new Float64Array(NC)
  for (let n = 0; n < NC; n++) k[n] = fc[n] * K_TIM_IN + (1 - fc[n]) * K_TIM_OUT
  return k
})()

const OFF = [0, NC, 2 * NC, 3 * NC, 3 * NC + NSPR]
const N = 3 * NC + NSPR + NS * NS

interface Csr {
  rowPtr: Int32Array
  col: Int32Array
  val: Float64Array
  dinv: Float64Array
}

function assemble(layout: Layout): { csr: Csr; boxes: [string, [number, number, number, number]][] } {
  const A = (H * 1e-3) * (H * 1e-3)
  const boxes: [string, [number, number, number, number]][] = []
  for (const [d, [x, y]] of Object.entries(layout)) {
    const [w, hh] = spec.dies[d].size_mm
    boxes.push([d, [x, y, x + w, y + hh]])
  }
  const fd = cover(boxes.map((b) => b[1]))
  const kDie = new Float64Array(NC)
  for (let n = 0; n < NC; n++) kDie[n] = fd[n] * K_SI + (1 - fd[n]) * K_GAP

  const I: number[] = []
  const J: number[] = []
  const G: number[] = []
  const link = (i: number, j: number, g: number) => { I.push(i); J.push(j); G.push(g) }

  // lateral conduction on an ny x nx grid; ids(j,i) gives node id or -1
  const lateral = (kmap: (j: number, i: number) => number, t: number, ky: number, kx: number, id: (j: number, i: number) => number) => {
    for (let j = 0; j < ky; j++) {
      for (let i = 0; i < kx; i++) {
        const a = id(j, i)
        const ka = kmap(j, i)
        if (i + 1 < kx) {
          const b = id(j, i + 1)
          if (a >= 0 && b >= 0) { const kb = kmap(j, i + 1); link(a, b, (2 * ka * kb) / (ka + kb) * t) }
        }
        if (j + 1 < ky) {
          const b = id(j + 1, i)
          if (a >= 0 && b >= 0) { const kb = kmap(j + 1, i); link(a, b, (2 * ka * kb) / (ka + kb) * t) }
        }
      }
    }
  }
  lateral(() => K_SI, T_IP, NY, NX, (j, i) => OFF[0] + j * NX + i)
  lateral((j, i) => kDie[j * NX + i], T_DIE, NY, NX, (j, i) => OFF[1] + j * NX + i)
  lateral((j, i) => kTim[j * NX + i], T_TIM, NY, NX, (j, i) => OFF[2] + j * NX + i)
  lateral(() => K_CU, T_SPR, NS, NS, (j, i) => (sprIdx[j * NS + i] >= 0 ? sprIdx[j * NS + i] + OFF[3] : -1))
  lateral(() => K_CU, T_SINK, NS, NS, (j, i) => OFF[4] + j * NS + i)

  const rv = (t1: number, k1: number, t2: number, k2: number) => 1 / (t1 / (2 * k1 * A) + t2 / (2 * k2 * A))
  for (let c = 0; c < NC; c++) {
    const j = Math.floor(c / NX)
    const i = c - j * NX
    link(OFF[0] + c, OFF[1] + c, rv(T_IP, K_SI, T_DIE, kDie[c]))
    link(OFF[1] + c, OFF[2] + c, rv(T_DIE, kDie[c], T_TIM, kTim[c]))
    const sc = sprIdx[(j + OY) * NS + (i + OX)]
    link(OFF[2] + c, OFF[3] + sc, rv(T_TIM, kTim[c], T_SPR, K_CU))
  }
  const g34 = rv(T_SPR, K_CU, T_SINK, K_CU)
  for (let s = 0; s < NS * NS; s++) if (sprIdx[s] >= 0) link(OFF[3] + sprIdx[s], OFF[4] + s, g34)

  const gconv = 1 / R_CONV / (NS * NS)
  const diag = new Float64Array(N)
  for (let s = 0; s < NS * NS; s++) diag[OFF[4] + s] += gconv
  const deg = new Int32Array(N)
  const nl = I.length
  for (let e = 0; e < nl; e++) { deg[I[e]]++; deg[J[e]]++; diag[I[e]] += G[e]; diag[J[e]] += G[e] }
  const dinv = new Float64Array(N)
  for (let n = 0; n < N; n++) dinv[n] = 1 / Math.sqrt(diag[n])
  const rowPtr = new Int32Array(N + 1)
  for (let n = 0; n < N; n++) rowPtr[n + 1] = rowPtr[n] + deg[n] + 1
  const col = new Int32Array(rowPtr[N])
  const val = new Float64Array(rowPtr[N])
  const fill = new Int32Array(N)
  for (let n = 0; n < N; n++) { col[rowPtr[n]] = n; val[rowPtr[n]] = 1; fill[n] = 1 }
  for (let e = 0; e < nl; e++) {
    const i = I[e], j = J[e], v = -G[e] * dinv[i] * dinv[j]
    let p = rowPtr[i] + fill[i]++; col[p] = j; val[p] = v
    p = rowPtr[j] + fill[j]++; col[p] = i; val[p] = v
  }
  return { csr: { rowPtr, col, val, dinv }, boxes }
}

/** CG on the (already Jacobi-scaled) CSR system; x is warm start and result. */
function cg(m: Csr, b: Float64Array, x: Float64Array, rtol: number, maxiter: number): void {
  const { rowPtr, col, val } = m
  const n = b.length
  const r = new Float64Array(n)
  const p = new Float64Array(n)
  const q = new Float64Array(n)
  const matvec = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let k = rowPtr[i], e = rowPtr[i + 1]; k < e; k++) s += val[k] * v[col[k]]
      out[i] = s
    }
  }
  let bn = 0
  for (let i = 0; i < n; i++) bn += b[i] * b[i]
  const tol = rtol * Math.sqrt(bn)
  matvec(x, q)
  let rr = 0
  for (let i = 0; i < n; i++) { r[i] = b[i] - q[i]; p[i] = r[i]; rr += r[i] * r[i] }
  for (let it = 0; it < maxiter && Math.sqrt(rr) > tol; it++) {
    matvec(p, q)
    let pq = 0
    for (let i = 0; i < n; i++) pq += p[i] * q[i]
    const alpha = rr / pq
    let rrNew = 0
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * q[i]; rrNew += r[i] * r[i] }
    const beta = rrNew / rr
    rr = rrNew
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i]
    if (it === maxiter - 1 && Math.sqrt(rr) > tol) throw new Error('CG did not converge')
  }
}

export type PerWorkload = Record<string, Record<string, number>>

export interface LowfiResult {
  /** Peak die-plane temperature (C) per workload, per die. */
  per: PerWorkload
  /** Die-plane temperature field (C), row-major [y][x], NX x NY cells of 1 mm, per workload. */
  fields: Record<string, Float64Array>
  nx: number
  ny: number
}

export function evaluateLowfiDetailed(layout: Layout, routing: Pick<Routing, 'routes'>, only?: string[]): LowfiResult {
  const { csr, boxes } = assemble(layout)
  const masks = boxes.map(([d, b]) => [d, cover([b])] as const)
  const n = spec.power_pixels_per_die_side
  const x = new Float64Array(N)
  const per: PerWorkload = {}
  const fields: Record<string, Float64Array> = {}
  const boxMap = new Map(boxes)
  for (const wl of only ?? WORKLOAD_NAMES) {
    const heat = combinedHeat(wl, layout, routing)
    const b = new Float64Array(N)
    const qDie = new Float64Array(NC)
    for (const [d, m] of Object.entries(heat.dieMapsW)) {
      const [x0, y0, x1, y1] = boxMap.get(d)!
      const dx = (x1 - x0) / n
      const dy = (y1 - y0) / n
      const ox: number[][] = []
      const oy: number[][] = []
      for (let p = 0; p < n; p++) {
        const px = x0 + p * dx
        const py = y0 + p * dy
        ox.push(Array.from(xs0, (c) => Math.max(Math.min(px + dx, c + H) - Math.max(px, c), 0) / dx))
        oy.push(Array.from(ys0, (c) => Math.max(Math.min(py + dy, c + H) - Math.max(py, c), 0) / dy))
      }
      for (let row = 0; row < n; row++) {
        for (let colp = 0; colp < n; colp++) {
          const v = m[row][colp]
          if (v === 0) continue
          for (let j = 0; j < NY; j++) {
            const w = oy[row][j] * v
            if (w === 0) continue
            for (let i = 0; i < NX; i++) qDie[j * NX + i] += w * ox[colp][i]
          }
        }
      }
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      b[OFF[0] + j * NX + i] = heat.interposerTilesW[j][i]
      b[OFF[1] + j * NX + i] = qDie[j * NX + i]
    }
    for (let k = 0; k < N; k++) b[k] *= csr.dinv[k]
    cg(csr, b, x, 1e-9, 20000)
    const T = new Float64Array(NC)
    for (let c = 0; c < NC; c++) T[c] = x[OFF[1] + c] * csr.dinv[OFF[1] + c] + AMBIENT
    fields[wl] = T
    per[wl] = {}
    for (const [d, mask] of masks) {
      let mx = -Infinity
      for (let c = 0; c < NC; c++) if (mask[c] > 0.5 && T[c] > mx) mx = T[c]
      per[wl][d] = mx
    }
  }
  return { per, fields, nx: NX, ny: NY }
}

export function evaluateLowfi(layout: Layout, routing: Pick<Routing, 'routes'>): PerWorkload {
  return evaluateLowfiDetailed(layout, routing).per
}

export const REF_G = 104.59
export const REF_H = 97.68

export type Coef = Record<string, [number, number]>

/** Mirrors predict() in scripts/official/loop.py. */
export function predictScore(per: PerWorkload, coef: Coef): { score: number; gpu: number; hbm: number } {
  let g = -1e9
  let h = -1e9
  for (const [wl, p] of Object.entries(per)) {
    for (const [d, t] of Object.entries(p)) {
      const [a, b] = coef[`${d[0]}|${wl}`]
      const v = a * t + b
      if (d[0] === 'G') g = Math.max(g, v)
      else h = Math.max(h, v)
    }
  }
  return { score: Math.max((g - AMBIENT) / (REF_G - AMBIENT), (h - AMBIENT) / (REF_H - AMBIENT)), gpu: g, hbm: h }
}
