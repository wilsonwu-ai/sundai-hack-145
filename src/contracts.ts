// Frozen contract shared by every module. Units: mm for geometry, W for power,
// °C for temperature. Origin is the top-left corner of the interposer; x grows
// right, y grows down. Changing this file means changing every lane, so don't.

export type ChipletKind = 'compute' | 'hbm' | 'io'

export interface Chiplet {
  id: string
  kind: ChipletKind
  /** width and height, mm */
  w: number
  h: number
  /** top-left corner, mm */
  x: number
  y: number
  /** steady-state power, W (after the workload is applied) */
  powerW: number
}

export interface PackageSpec {
  /** interposer width and height, mm */
  W: number
  H: number
  /** grid resolution (cells per side) */
  nx: number
  ny: number
  /** in-plane spreading conductance per square, k·t (W/K) */
  ktEff: number
  /** vertical heat-transfer coefficient to coolant, W/(m²·K) */
  hEff: number
  /** coolant temperature, °C */
  tAmb: number
  /** minimum edge-to-edge gap between chiplets, mm */
  minGap: number
}

export interface Layout {
  pkg: PackageSpec
  chiplets: Chiplet[]
}

export interface Workload {
  id: string
  label: string
  blurb: string
  /** power per kind = base power × factor */
  factor: Record<ChipletKind, number>
}

export interface SolveResult {
  /** row-major nx·ny temperatures, °C; index = j * nx + i */
  grid: Float64Array
  nx: number
  ny: number
  tMax: number
  tMean: number
  /** cell of the hottest point */
  hotI: number
  hotJ: number
  iterations: number
  /** relative residual at exit */
  residual: number
}

export interface Sample {
  layout: Layout
  tMax: number
}

export interface Surrogate {
  /** fit on full-solver samples; may be called repeatedly with a growing set */
  train(samples: Sample[]): void
  /** predicted tMax, °C. Must be cheap: thousands of calls per second. */
  predict(layout: Layout): number
  /** number of samples it was last trained on */
  readonly trainedOn: number
}

export interface OptimizeOptions {
  /** max full-solver calls the optimizer may spend (training + verification) */
  solverBudget: number
  /** max surrogate predictions */
  surrogateBudget: number
  seed: number
  /** called periodically; return value ignored. Use it to drive the UI. */
  onProgress?: (p: OptimizeProgress) => void
  /** if it returns true, stop early and return the best verified layout */
  shouldStop?: () => boolean
}

export interface OptimizeProgress {
  phase: 'sampling' | 'training' | 'searching' | 'verifying' | 'done'
  solverCalls: number
  surrogateCalls: number
  /** best tMax verified by the FULL solver so far */
  bestVerifiedTMax: number
  bestLayout: Layout
  /** surrogate prediction for the current candidate */
  lastPredicted?: number
  history: HistoryPoint[]
}

export interface HistoryPoint {
  solverCalls: number
  surrogateCalls: number
  predicted: number | null
  verified: number | null
}

export interface OptimizeResult {
  start: Layout
  startTMax: number
  best: Layout
  /** ALWAYS from the full solver, never the surrogate */
  bestTMax: number
  solverCalls: number
  surrogateCalls: number
  history: HistoryPoint[]
  /** mean absolute error of the surrogate on held-out verified points, °C */
  surrogateMAE: number
}
