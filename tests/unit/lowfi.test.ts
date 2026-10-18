import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateLayout, type Layout } from '../../src/official'
import { evaluateLowfi, predictScore, WORKLOAD_NAMES } from '../../src/official/lowfi'

const dir = join(__dirname, '..', 'fixtures', 'lowfi')
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { name: string; layout: Layout; per: Record<string, Record<string, number>> })

describe('lowfi port', () => {
  it('has 5 fixtures', () => expect(fixtures.length).toBe(5))
  for (const fx of fixtures) {
    it(`matches python within 0.02 C: ${fx.name}`, () => {
      const v = validateLayout(fx.layout)
      expect(v.ok).toBe(true)
      if (!v.ok) return
      const t0 = performance.now()
      const per = evaluateLowfi(fx.layout, v)
      const ms = performance.now() - t0
      let maxErr = 0
      for (const wl of WORKLOAD_NAMES) for (const [d, t] of Object.entries(fx.per[wl])) maxErr = Math.max(maxErr, Math.abs(per[wl][d] - t))
      console.log(`${fx.name}: ${ms.toFixed(0)} ms, max abs err ${maxErr.toExponential(2)} C`)
      expect(maxErr).toBeLessThan(0.02)
    })
  }
  it('predictScore with identity coefficients', () => {
    const fx = fixtures[0]
    const v = validateLayout(fx.layout)
    if (!v.ok) throw new Error('illegal')
    const coef: Record<string, [number, number]> = {}
    for (const c of ['G', 'H']) for (const wl of WORKLOAD_NAMES) coef[`${c}|${wl}`] = [1, 0]
    const r = predictScore(fx.per, coef)
    expect(r.score).toBeGreaterThan(0)
    expect(r.gpu).toBeGreaterThan(25)
  })
})
