// The surrogate loop (Track 2) and the solver-only baseline it is judged against.
//
//   sample -> train -> [ anneal on the surrogate -> verify top candidates with the
//   full solver -> add to training set -> retrain ] until a budget runs out.
//
// Every number reported as a result comes from the full solver. Deterministic for
// a given seed: only mulberry32 randomness is used.

import type {
  HistoryPoint,
  Layout,
  OptimizeOptions,
  OptimizeProgress,
  OptimizeResult,
  Sample,
  Surrogate,
} from '../contracts'
import { cloneLayout } from './presets'
import { layoutDistance, perturb, randomLegalLayout, tryPerturb } from './moves'
import { mulberry32 } from './rng'
import { solve } from './solver'
import { createSurrogate } from './surrogate'

const now = () => performance.now()

class Runner {
  calls = 0
  sCalls = 0
  bestLayout: Layout
  bestT: number
  readonly startT: number
  history: HistoryPoint[] = []
  phase: OptimizeProgress['phase'] = 'sampling'
  lastPredicted: number | undefined = undefined
  private lastYield = now()
  private lastReport = now()

  constructor(
    readonly start: Layout,
    readonly opts: OptimizeOptions,
  ) {
    this.startT = solve(start).tMax
    this.calls = 1
    this.bestLayout = cloneLayout(start)
    this.bestT = this.startT
    this.history.push({ solverCalls: 1, surrogateCalls: 0, predicted: null, verified: this.startT })
  }

  verify(layout: Layout): number {
    this.calls++
    return solve(layout).tMax
  }

  /** Record a verified point and keep the best. */
  note(layout: Layout, t: number, predicted: number | null): void {
    this.history.push({ solverCalls: this.calls, surrogateCalls: this.sCalls, predicted, verified: t })
    if (t < this.bestT) {
      this.bestT = t
      this.bestLayout = cloneLayout(layout)
    }
  }

  stopped(): boolean {
    return this.opts.shouldStop?.() === true
  }

  private emit(): void {
    this.lastReport = now()
    this.opts.onProgress?.({
      phase: this.phase,
      solverCalls: this.calls,
      surrogateCalls: this.sCalls,
      bestVerifiedTMax: this.bestT,
      bestLayout: this.bestLayout,
      lastPredicted: this.lastPredicted,
      history: this.history.slice(),
    })
  }

  setPhase(p: OptimizeProgress['phase']): void {
    this.phase = p
    this.emit()
  }

  /** Report every ~50 ms of work, yield to the event loop every ~25 ms. */
  async tick(): Promise<void> {
    const t = now()
    if (t - this.lastReport >= 50) this.emit()
    if (t - this.lastYield >= 25) {
      await new Promise<void>((r) => setTimeout(r, 0))
      this.lastYield = now()
    }
  }

  finish(mae: number): OptimizeResult {
    this.phase = 'done'
    this.emit()
    return {
      start: this.start,
      startTMax: this.startT,
      best: this.bestLayout,
      bestTMax: this.bestT,
      solverCalls: this.calls,
      surrogateCalls: this.sCalls,
      history: this.history,
      surrogateMAE: mae,
    }
  }
}

const geo = (a: number, b: number, f: number) => a * Math.pow(b / a, Math.min(1, Math.max(0, f)))

interface Cand {
  layout: Layout
  pred: number | null
}

async function annealOnSurrogate(
  run: Runner,
  sur: Surrogate,
  rng: () => number,
  from: Layout,
  steps: number,
  t0: number,
  t1: number,
  scale0: number,
  scale1: number,
  pool: { layout: Layout; pred: number }[],
): Promise<void> {
  let cur = from
  let curP = sur.predict(cur)
  run.sCalls++
  pool.push({ layout: cur, pred: curP })
  for (let s = 0; s < steps; s++) {
    const f = s / steps
    const temp = geo(t0, t1, f)
    const sc = geo(scale0, scale1, f) * (0.5 + rng())
    const nxt = tryPerturb(cur, rng, sc)
    if (nxt) {
      const p = sur.predict(nxt)
      run.sCalls++
      const d = p - curP
      if (d <= 0 || rng() < Math.exp(-d / temp)) {
        cur = nxt
        curP = p
        pool.push({ layout: cur, pred: curP })
        if (pool.length > 80) {
          pool.sort((a, b) => a.pred - b.pred)
          pool.length = 40
        }
      }
      run.lastPredicted = curP
    }
    if ((s & 31) === 31) await run.tick()
  }
}

export async function optimize(start: Layout, opts: OptimizeOptions): Promise<OptimizeResult> {
  const run = new Runner(start, opts)
  const rng = mulberry32(opts.seed)
  const B = opts.solverBudget
  const samples: Sample[] = [{ layout: cloneLayout(start), tMax: run.startT }]

  // (a) sampling: half random legal layouts, half chained perturbations of start.
  run.setPhase('sampling')
  const nSamp = Math.max(0, Math.min(60, Math.floor(0.4 * B), B - run.calls))
  for (let i = 0; i < nSamp && run.calls < B && !run.stopped(); i++) {
    let cand: Layout
    if (i % 2 === 0) {
      cand = randomLegalLayout(start, rng)
    } else {
      cand = start
      const k = 1 + Math.floor(rng() * 4)
      const sc = 2 + rng() * 6
      for (let m = 0; m < k; m++) cand = perturb(cand, rng, sc)
    }
    const t = run.verify(cand)
    samples.push({ layout: cand, tMax: t })
    run.note(cand, t, null)
    await run.tick()
  }

  // (b) train
  run.setPhase('training')
  const sur = createSurrogate()
  sur.train(samples)

  // (c) search / verify / retrain
  const K = 3
  const totalRounds = Math.max(1, Math.ceil((B - run.calls) / K))
  let round = 0
  let maeSum = 0
  let maeN = 0
  while (run.calls < B && run.sCalls < opts.surrogateBudget && !run.stopped()) {
    const roundsLeft = Math.max(1, Math.ceil((B - run.calls) / K))
    const perRound = Math.min(2400, Math.floor((opts.surrogateBudget - run.sCalls) / roundsLeft))
    const steps = Math.floor(perRound / 3) - 1
    if (steps < 1) break
    const g = round / Math.max(1, totalRounds - 1)
    const gNext = (round + 1) / Math.max(1, totalRounds - 1)

    run.setPhase('searching')
    const ranked = samples.slice().sort((a, b) => a.tMax - b.tMax)
    const starts: Layout[] = [run.bestLayout]
    let second = ranked.find((s) => layoutDistance(s.layout, run.bestLayout) > 2)
    if (!second) second = ranked[Math.min(1, ranked.length - 1)]
    starts.push(second.layout)
    starts.push(ranked[Math.floor(rng() * Math.min(5, ranked.length))].layout)
    const tBase = [1.5, 3, 0.8]
    const pool: { layout: Layout; pred: number }[] = []
    for (let r = 0; r < 3; r++) {
      await annealOnSurrogate(
        run,
        sur,
        rng,
        starts[r],
        steps,
        tBase[r] * (1 - 0.6 * Math.min(1, g)),
        0.05,
        geo(6, 0.5, g),
        geo(6, 0.5, gNext),
        pool,
      )
      if (run.stopped()) break
    }

    pool.sort((a, b) => a.pred - b.pred)
    const chosen: Cand[] = []
    for (const c of pool) {
      if (chosen.length >= K) break
      if (
        chosen.every((x) => layoutDistance(x.layout, c.layout) > 1.5) &&
        samples.every((s) => layoutDistance(s.layout, c.layout) > 0.3)
      ) {
        chosen.push({ layout: c.layout, pred: c.pred })
      }
    }
    if (chosen.length === 0) {
      const fb = tryPerturb(run.bestLayout, rng, 1.5) ?? randomLegalLayout(run.bestLayout, rng)
      chosen.push({ layout: fb, pred: null })
    }

    run.setPhase('verifying')
    for (const c of chosen) {
      if (run.calls >= B) break
      const t = run.verify(c.layout)
      if (c.pred !== null) {
        maeSum += Math.abs(c.pred - t)
        maeN++
      }
      samples.push({ layout: c.layout, tMax: t })
      run.note(c.layout, t, c.pred)
      run.lastPredicted = c.pred ?? undefined
      await run.tick()
    }

    run.setPhase('training')
    sur.train(samples)
    round++
  }

  return run.finish(maeN > 0 ? maeSum / maeN : 0)
}

/** Baseline: the same annealing and moves, but every evaluation is a full solve. */
export async function optimizeSolverOnly(start: Layout, opts: OptimizeOptions): Promise<OptimizeResult> {
  const run = new Runner(start, opts)
  const rng = mulberry32(opts.seed)
  const B = opts.solverBudget
  const steps = Math.max(1, B - 1)
  let cur = start
  let curT = run.startT
  let done = 0
  let guard = 0
  run.setPhase('searching')
  while (run.calls < B && guard < 10 * B + 10 && !run.stopped()) {
    guard++
    const f = done / steps
    const temp = geo(2, 0.05, f)
    const sc = geo(6, 0.5, f) * (0.5 + rng())
    const nxt = tryPerturb(cur, rng, sc)
    if (!nxt) continue
    const t = run.verify(nxt)
    done++
    run.note(nxt, t, null)
    const d = t - curT
    if (d <= 0 || rng() < Math.exp(-d / temp)) {
      cur = nxt
      curT = t
    }
    await run.tick()
  }
  return run.finish(0)
}
