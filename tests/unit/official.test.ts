import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { combinedHeat, parseSubmission, pyFixed, pyRound, validateLayout, workloads, spec, type Layout } from '../../src/official'

const dir = join(__dirname, '..', 'fixtures', 'official')

interface Fixture {
  name: string
  layout: Layout
  ok: boolean
  category: string
  error?: string
  routes?: Record<string, { path_grid: number[][]; route_length_mm: number; from_port: number[]; to_port: number[] }>
  weighted_route_gb_s_mm?: number
  weighted_unrounded?: number
  heat?: Record<string, { die_maps_w: Record<string, number[][]>; interposer_tiles_w: number[][]; total_w: number }>
}

const fixtures: Fixture[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fixture)

function relClose(a: number, b: number, tol = 1e-9) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
}

describe('official rules port', () => {
  it('has a healthy fixture set', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(40)
    expect(fixtures.some((f) => f.ok)).toBe(true)
    expect(fixtures.some((f) => !f.ok)).toBe(true)
  })

  it('workloads data matches spec workloads', () => {
    for (const [name, w] of Object.entries(workloads)) expect(w.link_utilization).toEqual(spec.workloads[name].link_utilization)
  })

  for (const fx of fixtures) {
    it(`${fx.name} (${fx.category})`, () => {
      const res = validateLayout(fx.layout)
      expect(res.ok).toBe(fx.ok)
      if (!fx.ok) {
        if (res.ok) throw new Error('unreachable')
        expect(res.reason).toBe(fx.error)
        return
      }
      if (!res.ok) throw new Error(`TS rejected a legal layout: ${res.reason}`)
      for (const [id, r] of Object.entries(fx.routes!)) {
        const t = res.routes[id]
        expect(t.pathGrid, `${id} path`).toEqual(r.path_grid)
        expect(t.routeLengthMm, `${id} length`).toBe(r.route_length_mm)
        expect(Math.abs(t.fromPort[0] - r.from_port[0]) + Math.abs(t.fromPort[1] - r.from_port[1])).toBeLessThan(1e-9)
        expect(Math.abs(t.toPort[0] - r.to_port[0]) + Math.abs(t.toPort[1] - r.to_port[1])).toBeLessThan(1e-9)
      }
      expect(Math.abs(res.weightedBudget - fx.weighted_unrounded!)).toBeLessThan(1e-9)
      expect(res.weightedRouteGbSmm).toBe(fx.weighted_route_gb_s_mm)

      for (const [w, ref] of Object.entries(fx.heat!)) {
        const h = combinedHeat(w, fx.layout, res)
        for (const [die, m] of Object.entries(ref.die_maps_w)) {
          for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
            if (!relClose(h.dieMapsW[die][r][c], m[r][c])) throw new Error(`${w} ${die}[${r}][${c}] ${h.dieMapsW[die][r][c]} vs ${m[r][c]}`)
          }
        }
        expect(h.interposerTilesW.length).toBe(ref.interposer_tiles_w.length)
        for (let j = 0; j < ref.interposer_tiles_w.length; j++) for (let i = 0; i < ref.interposer_tiles_w[j].length; i++) {
          if (!relClose(h.interposerTilesW[j][i], ref.interposer_tiles_w[j][i])) throw new Error(`${w} tile[${j}][${i}] ${h.interposerTilesW[j][i]} vs ${ref.interposer_tiles_w[j][i]}`)
        }
        expect(relClose(h.totalW, ref.total_w)).toBe(true)
      }
    })
  }

  it('python-style rounding helpers', () => {
    expect(pyRound(0.0625, 3)).toBe(0.062)
    expect(pyRound(2.675, 2)).toBe(2.67)
    expect(pyFixed(1.005, 2)).toBe('1.00')
    expect(pyFixed(12.5, 0)).toBe('12')
  })

  it('parseSubmission mirrors parse_submission checks', () => {
    const ok = parseSubmission({ placements_mm: spec.example_layouts_mm.ring_center })
    expect(ok.ok).toBe(true)
    expect(parseSubmission({ placements_mm: {} }).ok).toBe(false)
    expect(parseSubmission({ foo: 1 }).ok).toBe(false)
  })
})
