// Surrogate: standardized physics features -> ridge regression (closed form via
// Cholesky), ridge strength chosen by exact leave-one-out on the training set.

import type { Layout, Sample, Surrogate } from '../contracts'
import { N_FEATURES, features } from './features'

/** Inverse of a symmetric positive-definite d×d matrix via Cholesky. */
function cholInverse(A: Float64Array, d: number): Float64Array {
  const L = new Float64Array(d * d)
  for (let i = 0; i < d; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * d + j]
      for (let k = 0; k < j; k++) s -= L[i * d + k] * L[j * d + k]
      if (i === j) L[i * d + i] = Math.sqrt(Math.max(s, 1e-12))
      else L[i * d + j] = s / L[j * d + j]
    }
  }
  const inv = new Float64Array(d * d)
  const col = new Float64Array(d)
  for (let c = 0; c < d; c++) {
    for (let i = 0; i < d; i++) {
      let s = i === c ? 1 : 0
      for (let k = 0; k < i; k++) s -= L[i * d + k] * col[k]
      col[i] = s / L[i * d + i]
    }
    for (let i = d - 1; i >= 0; i--) {
      let s = col[i]
      for (let k = i + 1; k < d; k++) s -= L[k * d + i] * col[k]
      col[i] = s / L[i * d + i]
    }
    for (let i = 0; i < d; i++) inv[i * d + c] = col[i]
  }
  return inv
}

const LAMBDA_GRID = [1e-5, 1e-4, 1e-3, 1e-2, 3e-2, 0.1]

export function createSurrogate(): Surrogate {
  const D = N_FEATURES
  let mu = new Float64Array(D)
  let sd = new Float64Array(D).fill(1)
  let w = new Float64Array(D)
  let yMean = 0
  let trained = 0

  return {
    train(samples: Sample[]): void {
      const n = samples.length
      trained = n
      if (n === 0) return
      const F = samples.map((s) => features(s.layout))
      const newMu = new Float64Array(D)
      const newSd = new Float64Array(D)
      for (let k = 0; k < D; k++) {
        let m = 0
        for (let i = 0; i < n; i++) m += F[i][k]
        m /= n
        let v = 0
        for (let i = 0; i < n; i++) v += (F[i][k] - m) * (F[i][k] - m)
        const s = Math.sqrt(v / n)
        newMu[k] = m
        newSd[k] = s < 1e-9 ? 1 : s
      }
      let ym = 0
      for (const s of samples) ym += s.tMax
      ym /= n
      mu = newMu
      sd = newSd
      yMean = ym
      w = new Float64Array(D)
      if (n < 3) return

      const X = new Float64Array(n * D)
      const y = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        y[i] = samples[i].tMax - ym
        for (let k = 0; k < D; k++) X[i * D + k] = (F[i][k] - mu[k]) / sd[k]
      }
      const XtX = new Float64Array(D * D)
      const Xty = new Float64Array(D)
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < D; a++) {
          const xa = X[i * D + a]
          Xty[a] += xa * y[i]
          for (let b = 0; b <= a; b++) XtX[a * D + b] += xa * X[i * D + b]
        }
      }
      for (let a = 0; a < D; a++) for (let b = a + 1; b < D; b++) XtX[a * D + b] = XtX[b * D + a]

      let bestSse = Infinity
      let bestW = new Float64Array(D)
      for (const g of LAMBDA_GRID) {
        const A = XtX.slice()
        for (let a = 0; a < D; a++) A[a * D + a] += g * n
        const inv = cholInverse(A, D)
        const wl = new Float64Array(D)
        for (let a = 0; a < D; a++) {
          let s = 0
          for (let b = 0; b < D; b++) s += inv[a * D + b] * Xty[b]
          wl[a] = s
        }
        let sse = 0
        const tmp = new Float64Array(D)
        for (let i = 0; i < n; i++) {
          let pred = 0
          for (let a = 0; a < D; a++) pred += wl[a] * X[i * D + a]
          let h = 0
          for (let a = 0; a < D; a++) {
            let s = 0
            for (let b = 0; b < D; b++) s += inv[a * D + b] * X[i * D + b]
            tmp[a] = s
            h += X[i * D + a] * s
          }
          const r = (y[i] - pred) / Math.max(1 - h, 1e-6)
          sse += r * r
        }
        if (sse < bestSse) {
          bestSse = sse
          bestW = wl
        }
      }
      w = bestW
    },

    predict(layout: Layout): number {
      const f = features(layout)
      let y = yMean
      for (let k = 0; k < D; k++) y += (w[k] * (f[k] - mu[k])) / sd[k]
      return y
    },

    get trainedOn(): number {
      return trained
    },
  }
}
