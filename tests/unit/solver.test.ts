// FROZEN anchor tests. These check the physics, not the optimizer. If one fails,
// the solver is wrong; no lane may loosen a tolerance to make it pass.
import { describe, expect, it } from 'vitest'
import type { Layout } from '../../src/contracts'
import { heatOut, rasterize, solve, totalPower, validate } from '../../src/engine/solver'
import { PKG, WORKLOADS, applyWorkload, defaultLayout } from '../../src/engine/presets'

const uniform = (P: number): Layout => ({
  pkg: { ...PKG },
  chiplets: [{ id: 'U', kind: 'compute', w: PKG.W, h: PKG.H, x: 0, y: 0, powerW: P }],
})

describe('rasterize', () => {
  it('conserves power, including chiplets off the cell grid', () => {
    const l = defaultLayout()
    l.chiplets[0].x += 0.37
    l.chiplets[0].y += 0.81
    const p = rasterize(l)
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(totalPower(l), 9)
  })
})

describe('solve', () => {
  it('uniform heating matches the 1D closed form T = T_amb + q/h', () => {
    const P = 1000
    const r = solve(uniform(P))
    const q = P / ((PKG.W / 1000) * (PKG.H / 1000))
    const expected = PKG.tAmb + q / PKG.hEff
    expect(r.tMax).toBeCloseTo(expected, 6)
    expect(r.tMean).toBeCloseTo(expected, 6)
  })

  it('energy balance: heat out equals power in within 1%', () => {
    for (const w of WORKLOADS) {
      const l = applyWorkload(defaultLayout(), w)
      const r = solve(l)
      expect(Math.abs(heatOut(l.pkg, r.grid) - totalPower(l)) / totalPower(l)).toBeLessThan(0.01)
    }
  })

  it('mirroring the layout mirrors the temperature field', () => {
    const l = defaultLayout()
    const m: Layout = {
      pkg: l.pkg,
      chiplets: l.chiplets.map((c) => ({ ...c, x: l.pkg.W - c.x - c.w })),
    }
    const a = solve(l)
    const b = solve(m)
    expect(b.tMax).toBeCloseTo(a.tMax, 6)
    const { nx, ny } = a
    for (let j = 0; j < ny; j += 7) {
      for (let i = 0; i < nx; i += 5) {
        expect(b.grid[j * nx + (nx - 1 - i)]).toBeCloseTo(a.grid[j * nx + i], 6)
      }
    }
  })

  it('is linear in power: doubling power doubles the rise', () => {
    const l = defaultLayout()
    const l2: Layout = { pkg: l.pkg, chiplets: l.chiplets.map((c) => ({ ...c, powerW: 2 * c.powerW })) }
    const a = solve(l).tMax - PKG.tAmb
    const b = solve(l2).tMax - PKG.tAmb
    expect(b / a).toBeCloseTo(2, 6)
  })

  it('better cooling lowers the peak', () => {
    const l = defaultLayout()
    const better: Layout = { pkg: { ...l.pkg, hEff: l.pkg.hEff * 2 }, chiplets: l.chiplets }
    expect(solve(better).tMax).toBeLessThan(solve(l).tMax)
  })

  it('converges and the default layout is hot but finite', () => {
    const r = solve(defaultLayout())
    expect(r.residual).toBeLessThan(1e-8)
    expect(r.tMax).toBeGreaterThan(60)
    expect(r.tMax).toBeLessThan(200)
  })
})

describe('validate', () => {
  it('accepts the default layout', () => {
    expect(validate(defaultLayout())).toBeNull()
  })
  it('rejects overlap and off-package chiplets', () => {
    const l = defaultLayout()
    l.chiplets[1].x = l.chiplets[0].x + 2
    expect(validate(l)).toMatch(/overlap/)
    const o = defaultLayout()
    o.chiplets[0].x = -1
    expect(validate(o)).toMatch(/off the interposer/)
  })
})

import { WIRE_BUDGET, checkLegal, wireLength } from '../../src/engine/constraints'
describe('constraints', () => {
  it('default layout is legal and sits under the wire budget', () => {
    expect(checkLegal(defaultLayout())).toBeNull()
    expect(wireLength(defaultLayout())).toBeLessThan(WIRE_BUDGET)
  })
  it('flinging compute dies to the corners breaks the wire budget', () => {
    const l = defaultLayout()
    const corners = [[0, 0], [46, 0], [0, 46], [46, 46]]
    l.chiplets.slice(0, 4).forEach((c, k) => { c.x = corners[k][0]; c.y = corners[k][1] })
    expect(checkLegal(l)).toMatch(/wire length|overlap/)
  })
})
