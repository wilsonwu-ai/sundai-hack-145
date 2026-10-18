import { beforeAll, describe, expect, it } from 'vitest'
import type { Layout, OptimizeResult } from '../../src/contracts'
import { checkLegal } from '../../src/engine/constraints'
import { perturb, randomLegalLayout } from '../../src/engine/moves'
import { optimize, optimizeSolverOnly } from '../../src/engine/optimize'
import { WORKLOADS, applyWorkload, defaultLayout } from '../../src/engine/presets'
import { mulberry32 } from '../../src/engine/rng'
import { solve } from '../../src/engine/solver'
import { createSurrogate } from '../../src/engine/surrogate'

const training = WORKLOADS.find((w) => w.id === 'training')!
const startLayout = (): Layout => applyWorkload(defaultLayout(), training)

describe('moves', () => {
  it('perturb and randomLegalLayout always return legal layouts', () => {
    const rng = mulberry32(7)
    let cur = startLayout()
    for (let i = 0; i < 200; i++) {
      cur = perturb(cur, rng, 3 + rng() * 6)
      expect(checkLegal(cur)).toBeNull()
    }
    for (let i = 0; i < 200; i++) {
      expect(checkLegal(randomLegalLayout(startLayout(), rng))).toBeNull()
    }
  })
})

describe('surrogate', () => {
  it('predicts held-out legal layouts within 2 C MAE after 120 samples', () => {
    const rng = mulberry32(11)
    const base = startLayout()
    const mk = (n: number) =>
      Array.from({ length: n }, () => {
        const layout = randomLegalLayout(base, rng)
        return { layout, tMax: solve(layout).tMax }
      })
    const train = mk(120)
    const test = mk(40)
    const s = createSurrogate()
    s.train(train)
    expect(s.trainedOn).toBe(120)
    const mae = test.reduce((a, t) => a + Math.abs(s.predict(t.layout) - t.tMax), 0) / test.length
    expect(mae).toBeLessThanOrEqual(2.0)
  }, 60000)
})

describe('optimize', () => {
  let a: OptimizeResult
  let b: OptimizeResult
  let base: OptimizeResult
  const start = startLayout()

  beforeAll(async () => {
    a = await optimize(start, { solverBudget: 120, surrogateBudget: 20000, seed: 1 })
    b = await optimize(start, { solverBudget: 120, surrogateBudget: 20000, seed: 1 })
    base = await optimizeSolverOnly(start, { solverBudget: 120, surrogateBudget: 0, seed: 1 })
  }, 120000)

  it('is deterministic for a given seed', () => {
    expect(b.bestTMax).toBe(a.bestTMax)
    expect(b.solverCalls).toBe(a.solverCalls)
  })

  it('returns a legal best whose tMax is the full solver value and no worse than start', () => {
    expect(checkLegal(a.best)).toBeNull()
    expect(a.bestTMax).toBeCloseTo(solve(a.best).tMax, 9)
    expect(a.bestTMax).toBeLessThanOrEqual(a.startTMax)
    expect(checkLegal(base.best)).toBeNull()
    expect(base.bestTMax).toBeCloseTo(solve(base.best).tMax, 9)
  })

  it('respects budgets and keeps chiplet identity, size and power', () => {
    expect(a.solverCalls).toBeLessThanOrEqual(120)
    expect(a.surrogateCalls).toBeLessThanOrEqual(20000)
    expect(base.solverCalls).toBeLessThanOrEqual(120)
    expect(base.surrogateCalls).toBe(0)
    for (const r of [a, base]) {
      expect(r.best.chiplets.length).toBe(start.chiplets.length)
      r.best.chiplets.forEach((c, i) => {
        const o = start.chiplets[i]
        expect(c.id).toBe(o.id)
        expect(c.kind).toBe(o.kind)
        expect(c.w).toBe(o.w)
        expect(c.h).toBe(o.h)
        expect(c.powerW).toBe(o.powerW)
      })
    }
  })

  it('beats 80 C on the training workload', () => {
    expect(a.bestTMax).toBeLessThan(80)
  })

  it('beats the solver-only baseline at the same solver budget', () => {
    expect(a.bestTMax).toBeLessThan(base.bestTMax)
  })
})
