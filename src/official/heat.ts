// Port of interconnect.combined_heat: workload-dependent PHY and routed-wire heat.
import workloadsJson from './data/workloads.json'
import { dieBox, spec, type ChallengeSpec, type Layout, type Routing, type Route } from './geometry'

export interface WorkloadData {
  link_utilization: Record<string, number>
  total_w: number
  per_die_total_w: Record<string, number>
  /** Base watts per cell (not W/mm^2); row 0 is the bottom edge of the die. */
  power_maps_w: Record<string, number[][]>
}
export const workloads = workloadsJson as unknown as Record<string, WorkloadData>

export interface HeatResult {
  /** Per die 16x16 watts after PHY heat inside the die. */
  dieMapsW: Record<string, number[][]>
  /** interposer tiles, indexed [row j][col i], ny x nx. */
  interposerTilesW: number[][]
  baseW: number
  phyW: number
  wireW: number
  totalW: number
}

type Rect = [number, number, number, number]
type Vec = [number, number]

function overlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
}

export function portRectangle(center: Vec, normal: Vec, length: number, depth: number): Rect {
  const [x, y] = center
  if (normal[0] !== 0) return [x - depth, y - length / 2, x + depth, y + length / 2]
  return [x - length / 2, y - depth, x + length / 2, y + depth]
}

export function routeSegments(route: Route, pitch: number): [Vec, Vec][] {
  const tracks: Vec[] = route.pathGrid.map(([i, j]) => [(i + 0.5) * pitch, (j + 0.5) * pitch])
  const result: [Vec, Vec][] = []
  const ends: [Vec, Vec, Vec][] = [
    [route.fromPort, tracks[0], route.fromNormal],
    [route.toPort, tracks[tracks.length - 1], route.toNormal],
  ]
  for (const [port, track, normal] of ends) {
    const corner: Vec = normal[0] !== 0 ? [track[0], port[1]] : [port[0], track[1]]
    result.push([port, corner], [corner, track])
  }
  for (let k = 0; k + 1 < tracks.length; k++) result.push([tracks[k], tracks[k + 1]])
  return result.filter(([a, b]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1e-10)
}

/** Exact lengths of one axis-aligned segment in each tile: [row j, col i, length]. */
export function segmentTileLengths(a: Vec, b: Vec, nx: number, ny: number, width: number, height: number): [number, number, number][] {
  const length = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
  const cuts = [0, 1]
  const axis = Math.abs(a[0] - b[0]) > 1e-10 ? 0 : 1
  const spacing = axis === 0 ? width / nx : height / ny
  const count = axis === 0 ? nx : ny
  for (let k = 1; k < count; k++) {
    const t = (k * spacing - a[axis]) / (b[axis] - a[axis])
    if (t > 0 && t < 1) cuts.push(t)
  }
  cuts.sort((p, q) => p - q)
  const out: [number, number, number][] = []
  for (let n = 0; n + 1 < cuts.length; n++) {
    const t0 = cuts[n]
    const t1 = cuts[n + 1]
    const tm = (t0 + t1) / 2
    const x = a[0] + tm * (b[0] - a[0])
    const y = a[1] + tm * (b[1] - a[1])
    const i = Math.min(nx - 1, Math.max(0, Math.trunc((x * nx) / width)))
    const j = Math.min(ny - 1, Math.max(0, Math.trunc((y * ny) / height)))
    out.push([j, i, (t1 - t0) * length])
  }
  return out
}

export function combinedHeat(
  workload: string,
  layout: Layout,
  routing: Pick<Routing, 'routes'>,
  s: ChallengeSpec = spec,
): HeatResult {
  const n = s.power_pixels_per_die_side
  const rule = s.interconnect_model
  const data = workloads[workload]
  const traffic = s.workloads[workload].link_utilization
  const links = s.links
  if (Object.keys(traffic).length !== links.length || links.some((l) => !(l.id in traffic))
    || Object.values(traffic).some((v) => !(v >= 0 && v <= 1))) {
    throw new Error(`${workload}: link utilization must cover each link in [0,1]`)
  }
  const dieMaps: Record<string, number[][]> = {}
  for (const [die, m] of Object.entries(data.power_maps_w)) dieMaps[die] = m.map((row) => [...row])
  const [nx, ny] = rule.interposer_heat_tiles
  const tile: number[][] = Array.from({ length: ny }, () => new Array<number>(nx).fill(0))
  const [width, height] = s.interposer_mm
  const pitch = s.port_rule.route_grid_pitch_mm
  const depth = rule.port_heat_depth_each_side_mm
  let phyTotal = 0
  let wireTotal = 0

  const addPortHeat = (die: string, port: Vec, normal: Vec, length: number, watts: number) => {
    const [x0, y0, x1, y1] = dieBox(layout, die, s)
    const rect = portRectangle(port, normal, length, depth)
    const density = watts / (2 * depth * length)
    const dx = (x1 - x0) / n
    const dy = (y1 - y0) / n
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const pixel: Rect = [x0 + col * dx, y0 + row * dy, x0 + (col + 1) * dx, y0 + (row + 1) * dy]
        dieMaps[die][row][col] += density * overlap(rect, pixel)
      }
    }
    let outside: Rect
    if (normal[0] > 0) outside = [port[0], rect[1], rect[2], rect[3]]
    else if (normal[0] < 0) outside = [rect[0], rect[1], port[0], rect[3]]
    else if (normal[1] > 0) outside = [rect[0], port[1], rect[2], rect[3]]
    else outside = [rect[0], rect[1], rect[2], port[1]]
    const tw = width / nx
    const th = height / ny
    const i0 = Math.max(0, Math.trunc(outside[0] / tw))
    const i1 = Math.min(nx, Math.ceil(outside[2] / tw))
    const j0 = Math.max(0, Math.trunc(outside[1] / th))
    const j1 = Math.min(ny, Math.ceil(outside[3] / th))
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        tile[j][i] += density * overlap(outside, [i * tw, j * th, (i + 1) * tw, (j + 1) * th])
      }
    }
  }

  for (const link of links) {
    const route = routing.routes[link.id]
    const rate = link.gb_s * traffic[link.id] * 8e9
    const phyW = rate * rule.phy_energy_total_pj_per_bit * 1e-12
    const wireW = rate * rule.wire_energy_pj_per_bit_per_mm * 1e-12 * route.routeLengthMm
    const gpuW = phyW * rule.phy_split_gpu_fraction
    const hbmW = phyW - gpuW
    addPortHeat(link.from, route.fromPort, route.fromNormal, route.requiredPortMm, gpuW)
    addPortHeat(link.to, route.toPort, route.toNormal, route.requiredPortMm, hbmW)
    const segments = routeSegments(route, pitch)
    let distance = 0
    for (const [a, b] of segments) distance += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
    if (distance <= 0 || Math.abs(distance - route.routeLengthMm) > 0.00101) throw new Error('wire route has zero length')
    for (const [a, b] of segments) {
      for (const [j, i, segLen] of segmentTileLengths(a, b, nx, ny, width, height)) {
        tile[j][i] += (wireW * segLen) / distance
      }
    }
    phyTotal += phyW
    wireTotal += wireW
  }

  const sum2 = (m: number[][]) => m.reduce((acc, r) => acc + r.reduce((x, y) => x + y, 0), 0)
  let baseW = 0
  for (const m of Object.values(data.power_maps_w)) baseW += sum2(m)
  let totalDie = 0
  for (const m of Object.values(dieMaps)) totalDie += sum2(m)
  const totalInterposer = sum2(tile)
  if (Math.abs(totalDie + totalInterposer - (baseW + phyTotal + wireTotal)) > 1e-4
    || Math.abs(totalDie - baseW - phyTotal / 2) > 1e-4
    || Math.abs(totalInterposer - wireTotal - phyTotal / 2) > 1e-4) {
    throw new Error('interconnect power was not conserved')
  }
  return { dieMapsW: dieMaps, interposerTilesW: tile, baseW, phyW: phyTotal, wireW: wireTotal, totalW: totalDie + totalInterposer }
}
