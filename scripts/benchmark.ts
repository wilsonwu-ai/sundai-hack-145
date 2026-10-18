// Run: npx vite-node scripts/benchmark.ts
// Writes state/results.json and prints a compact table.

import { mkdirSync, writeFileSync } from 'node:fs'
import type { OptimizeResult } from '../src/contracts'
import { optimize, optimizeSolverOnly } from '../src/engine/optimize'
import { WORKLOADS, applyWorkload, defaultLayout } from '../src/engine/presets'
import { solve } from '../src/engine/solver'

const SEEDS = [1, 2, 3]
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

async function main() {
  const out: Record<string, unknown> = {}
  const rows: string[] = []
  rows.push(
    ['workload', 'start', 'surr best', 'surr mean', 'surr worst', 'base best', 'base mean', 'brute best', 'MAE'].join('\t'),
  )
  for (const w of WORKLOADS) {
    const start = applyWorkload(defaultLayout(), w)
    const startTMax = solve(start).tMax

    const sRes: OptimizeResult[] = []
    const sMs: number[] = []
    for (const seed of SEEDS) {
      const t0 = performance.now()
      sRes.push(await optimize(start, { solverBudget: 150, surrogateBudget: 40000, seed }))
      sMs.push(performance.now() - t0)
    }
    const bRes: OptimizeResult[] = []
    for (const seed of SEEDS) {
      bRes.push(await optimizeSolverOnly(start, { solverBudget: 150, surrogateBudget: 0, seed }))
    }
    const t1 = performance.now()
    const brute = await optimizeSolverOnly(start, { solverBudget: 1500, surrogateBudget: 0, seed: 1 })
    const bruteMs = performance.now() - t1

    const sT = sRes.map((r) => r.bestTMax)
    const bT = bRes.map((r) => r.bestTMax)
    const bestIdx = sT.indexOf(Math.min(...sT))
    const entry: Record<string, unknown> = {
      startTMax,
      surrogate: {
        best: Math.min(...sT),
        mean: mean(sT),
        worst: Math.max(...sT),
        solverCalls: mean(sRes.map((r) => r.solverCalls)),
        surrogateCalls: mean(sRes.map((r) => r.surrogateCalls)),
        mae: mean(sRes.map((r) => r.surrogateMAE)),
        msElapsed: mean(sMs),
      },
      baselineSameBudget: { best: Math.min(...bT), mean: mean(bT) },
      bruteForce: { best: brute.bestTMax, solverCalls: brute.solverCalls, msElapsed: bruteMs },
    }
    if (w.id === 'training') entry.bestChiplets = sRes[bestIdx].best.chiplets
    out[w.id] = entry

    rows.push(
      [
        w.id,
        startTMax.toFixed(2),
        Math.min(...sT).toFixed(2),
        mean(sT).toFixed(2),
        Math.max(...sT).toFixed(2),
        Math.min(...bT).toFixed(2),
        mean(bT).toFixed(2),
        brute.bestTMax.toFixed(2),
        mean(sRes.map((r) => r.surrogateMAE)).toFixed(2),
      ].join('\t'),
    )
  }
  mkdirSync('state', { recursive: true })
  writeFileSync('state/results.json', JSON.stringify(out, null, 2))
  console.log(rows.join('\n'))
}

main()
