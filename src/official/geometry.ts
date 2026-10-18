// Independent TypeScript reimplementation of the organizer's placement, port and
// routing rules (geometry.py). Coordinates are millimetres from the lower-left
// corner. Behaviour, error order and A* tie-breaking mirror the Python reference.
import specJson from './data/spec.json'

export interface DieSpec {
  kind: 'GPU' | 'HBM'
  size_mm: [number, number]
}
export interface LinkSpec {
  id: string
  from: string
  to: string
  gb_s: number
  max_route_mm: number
}
export interface PortRule {
  density_gb_s_per_mm: number
  usable_center_fraction_of_each_die_side: number
  minimum_gap_between_ports_mm: number
  route_grid_pitch_mm: number
  route_clearance_mm: number
  total_bandwidth_weighted_route_limit_gb_s_mm: number
}
export interface InterconnectModel {
  phy_energy_total_pj_per_bit: number
  wire_energy_pj_per_bit_per_mm: number
  phy_split_gpu_fraction: number
  interposer_heat_tiles: [number, number]
  port_heat_depth_each_side_mm: number
}
export interface WorkloadSpec {
  profile: string
  link_utilization: Record<string, number>
}
export interface ChallengeSpec {
  interposer_mm: [number, number]
  edge_clearance_mm: number
  minimum_die_gap_mm: number
  port_rule: PortRule
  power_pixels_per_die_side: number
  dies: Record<string, DieSpec>
  links: LinkSpec[]
  workloads: Record<string, WorkloadSpec>
  interconnect_model: InterconnectModel
  example_layouts_mm: Record<string, Record<string, [number, number]>>
  reference_objectives_c: { worst_gpu_c: number; worst_hbm_c: number }
}

export const spec = specJson as unknown as ChallengeSpec

export type Layout = Record<string, [number, number]>
export type Box = [number, number, number, number]
export type Side = 'left' | 'right' | 'top' | 'bottom'
type Vec = [number, number]

export interface Port {
  side: Side
  center: Vec
  normal: Vec
  reservedLength: number
}

export interface Route {
  from: string
  to: string
  bandwidthGbS: number
  requiredPortMm: number
  fromPort: Vec
  toPort: Vec
  fromNormal: Vec
  toNormal: Vec
  routeLengthMm: number
  limitMm: number
  pathGrid: [number, number][]
}

export interface Routing {
  routes: Record<string, Route>
  dieEdgeCapacity: Record<string, { reservedMmIncludingGaps: number; availableMm: number }>
  /** Python's round(weighted, 2). */
  weightedRouteGbSmm: number
  /** Unrounded sum of gb_s * route_length_mm. */
  weightedBudget: number
  routeLimitGbSmm: number
}

export type ValidateResult = ({ ok: true } & Routing) | { ok: false; reason: string }

class RuleError extends Error {}

/** Python `format(x, f".{nd}f")`: exact binary value, ties to even. */
export function pyFixed(x: number, nd: number): string {
  if (!Number.isFinite(x)) return String(x)
  const exact = Math.abs(x).toFixed(Math.min(100, nd + 30))
  const dot = exact.indexOf('.')
  const keep = exact.slice(0, dot + 1 + nd)
  const rest = exact.slice(dot + 1 + nd)
  let up = false
  if (rest[0] > '5') up = true
  else if (rest[0] === '5') {
    if (/[1-9]/.test(rest.slice(1))) up = true
    else up = Number(keep.replace('.', '').slice(-1)) % 2 === 1
  }
  let s = keep
  if (up) {
    const digits = keep.replace('.', '')
    const bumped = (BigInt(digits) + 1n).toString().padStart(digits.length, '0')
    const ip = bumped.slice(0, bumped.length - nd)
    s = nd > 0 ? `${ip}.${bumped.slice(bumped.length - nd)}` : ip
  }
  if (nd === 0 && s.endsWith('.')) s = s.slice(0, -1)
  return (x < 0 || Object.is(x, -0) ? '-' : '') + s
}

/** Python str(float): integers print with a trailing .0. */
function pyRepr(x: number): string {
  return Number.isInteger(x) ? x.toFixed(1) : String(x)
}

/** Python round(x, nd) for finite floats. */
export function pyRound(x: number, nd: number): number {
  return Number(pyFixed(x, nd))
}

export function dieBox(layout: Layout, name: string, s: ChallengeSpec = spec): Box {
  const [x, y] = layout[name]
  const [w, h] = s.dies[name].size_mm
  return [x, y, x + w, y + h]
}

function sideOf(box: Box, other: Box): Side {
  const [x0, y0, x1, y1] = box
  const [ox0, oy0, ox1, oy1] = other
  const dx = (ox0 + ox1 - x0 - x1) / 2
  const dy = (oy0 + oy1 - y0 - y1) / 2
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'top' : 'bottom'
}

function sidePort(s: ChallengeSpec, box: Box, side: Side, allocatedIn: [string, number][]) {
  const [x0, y0, x1, y1] = box
  const horizontal = side === 'top' || side === 'bottom'
  const length = horizontal ? x1 - x0 : y1 - y0
  const rule = s.port_rule
  const capacity = length * rule.usable_center_fraction_of_each_die_side
  const gap = rule.minimum_gap_between_ports_mm
  const allocated = [...allocatedIn].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  let sum = 0
  for (const item of allocated) sum += item[1]
  const needed = sum + Math.max(0, allocated.length - 1) * gap
  if (needed > capacity + 1e-8) {
    throw new RuleError(`die-edge capacity: ${side} requires ${pyFixed(needed, 2)} mm, has ${pyFixed(capacity, 2)} mm`)
  }
  let axisStart = (horizontal ? x0 : y0) + (length - needed) / 2
  const ports = new Map<string, Port>()
  for (const [linkId, required] of allocated) {
    const middle = axisStart + required / 2
    let center: Vec
    let normal: Vec
    if (side === 'left') { center = [x0, middle]; normal = [-1, 0] }
    else if (side === 'right') { center = [x1, middle]; normal = [1, 0] }
    else if (side === 'bottom') { center = [middle, y0]; normal = [0, -1] }
    else { center = [middle, y1]; normal = [0, 1] }
    ports.set(linkId, { side, center, normal, reservedLength: required })
    axisStart += required + gap
  }
  return { ports, needed, capacity }
}

// Binary min-heap over (f, dist, i, j). The key is a total order, so pop order
// matches Python's heapq on (f, dist, (i, j)) tuples.
class Heap {
  private a: number[][] = []
  private less(p: number[], q: number[]) {
    for (let k = 0; k < 4; k++) if (p[k] !== q[k]) return p[k] < q[k]
    return false
  }
  get size() { return this.a.length }
  push(e: number[]) {
    const a = this.a
    a.push(e)
    let k = a.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (!this.less(a[k], a[p])) break
      ;[a[k], a[p]] = [a[p], a[k]]
      k = p
    }
  }
  pop(): number[] {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < a.length && this.less(a[l], a[m])) m = l
        if (r < a.length && this.less(a[r], a[m])) m = r
        if (m === k) break
        ;[a[k], a[m]] = [a[m], a[k]]
        k = m
      }
    }
    return top
  }
}

function routeGrid(s: ChallengeSpec, boxes: Map<string, Box>, a: Port, b: Port): [number, [number, number][]] {
  const rule = s.port_rule
  const pitch = rule.route_grid_pitch_mm
  const clearance = rule.route_clearance_mm
  const [width, height] = s.interposer_mm
  const nx = Math.round(width / pitch)
  const ny = Math.round(height / pitch)
  const boxList = [...boxes.values()]
  const posX = (i: number) => (i + 0.5) * pitch
  const posY = (j: number) => (j + 0.5) * pitch
  const blocked = (i: number, j: number) => {
    const x = posX(i)
    const y = posY(j)
    return boxList.some(([x0, y0, x1, y1]) => x0 - clearance < x && x < x1 + clearance && y0 - clearance < y && y < y1 + clearance)
  }
  const endpoint = (port: Port): [[number, number], number] => {
    const [x, y] = port.center
    const [dx, dy] = port.normal
    const px = x + dx * (clearance + pitch)
    const py = y + dy * (clearance + pitch)
    const cell: [number, number] = [Math.floor(px / pitch), Math.floor(py / pitch)]
    if (!(cell[0] >= 0 && cell[0] < nx && cell[1] >= 0 && cell[1] < ny) || blocked(cell[0], cell[1])) {
      throw new RuleError('port cannot access a free route track')
    }
    const access = Math.abs(x - posX(cell[0])) + Math.abs(y - posY(cell[1]))
    return [cell, access]
  }
  const [start, startAccess] = endpoint(a)
  const [goal, endAccess] = endpoint(b)
  const key = (i: number, j: number) => i * ny + j
  const distance = new Map<number, number>([[key(start[0], start[1]), 0]])
  const parent = new Map<number, [number, number]>()
  const heap = new Heap()
  heap.push([0, 0, start[0], start[1]])
  const deltas: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  while (heap.size) {
    const [, dist, ci, cj] = heap.pop()
    if (dist !== distance.get(key(ci, cj))) continue
    if (ci === goal[0] && cj === goal[1]) {
      const path: [number, number][] = [[goal[0], goal[1]]]
      for (;;) {
        const last = path[path.length - 1]
        if (last[0] === start[0] && last[1] === start[1]) break
        path.push(parent.get(key(last[0], last[1]))!)
      }
      path.reverse()
      return [pyRound(dist * pitch + startAccess + endAccess, 3), path]
    }
    for (const [di, dj] of deltas) {
      const ni = ci + di
      const nj = cj + dj
      if (!(ni >= 0 && ni < nx && nj >= 0 && nj < ny) || blocked(ni, nj)) continue
      const nd = dist + 1
      const old = distance.get(key(ni, nj))
      if (old === undefined || nd < old) {
        distance.set(key(ni, nj), nd)
        parent.set(key(ni, nj), [ci, cj])
        const h = Math.abs(ni - goal[0]) + Math.abs(nj - goal[1])
        heap.push([nd + h, nd, ni, nj])
      }
    }
  }
  throw new RuleError('no obstacle-free rectilinear route')
}

function validateOrThrow(s: ChallengeSpec, xy: Layout): Routing {
  const names = Object.keys(xy)
  const specNames = Object.keys(s.dies)
  if (names.length !== specNames.length || !specNames.every((n) => Object.prototype.hasOwnProperty.call(xy, n))) {
    throw new RuleError('place every GPU and HBM exactly once')
  }
  const [width, height] = s.interposer_mm
  const edge = s.edge_clearance_mm
  const gap = s.minimum_die_gap_mm
  const boxes = new Map<string, Box>()
  for (const n of names) boxes.set(n, dieBox(xy, n, s))
  for (const [name, [x0, y0, x1, y1]] of boxes) {
    if (Math.min(x0, y0) < edge - 1e-8 || x1 > width - edge + 1e-8 || y1 > height - edge + 1e-8) {
      throw new RuleError(`${name} violates package edge clearance`)
    }
  }
  const entries = [...boxes.entries()]
  for (let i = 0; i < entries.length; i++) {
    const [name, a] = entries[i]
    for (let k = i + 1; k < entries.length; k++) {
      const [other, b] = entries[k]
      const gx = Math.max(b[0] - a[2], a[0] - b[2], 0)
      const gy = Math.max(b[1] - a[3], a[1] - b[3], 0)
      if (gx < gap - 1e-8 && gy < gap - 1e-8) {
        throw new RuleError(`${name} and ${other} violate ${pyRepr(gap)} mm clearance`)
      }
    }
  }

  const assignments = new Map<string, { die: string; side: Side; items: [string, number][] }>()
  const density = s.port_rule.density_gb_s_per_mm
  for (const link of s.links) {
    for (const [die, neighbor] of [[link.from, link.to], [link.to, link.from]] as const) {
      const side = sideOf(boxes.get(die)!, boxes.get(neighbor)!)
      const k = `${die}|${side}`
      let e = assignments.get(k)
      if (!e) { e = { die, side, items: [] }; assignments.set(k, e) }
      e.items.push([link.id, link.gb_s / density])
    }
  }
  const ports = new Map<string, Map<string, Port>>()
  const dieEdgeCapacity: Routing['dieEdgeCapacity'] = {}
  for (const { die, side, items } of assignments.values()) {
    const { ports: selected, needed, capacity } = sidePort(s, boxes.get(die)!, side, items)
    let m = ports.get(die)
    if (!m) { m = new Map(); ports.set(die, m) }
    for (const [id, p] of selected) m.set(id, p)
    dieEdgeCapacity[`${die}.${side}`] = { reservedMmIncludingGaps: pyRound(needed, 3), availableMm: pyRound(capacity, 3) }
  }

  const routes: Record<string, Route> = {}
  let weighted = 0
  for (const link of s.links) {
    const a = ports.get(link.from)!.get(link.id)!
    const b = ports.get(link.to)!.get(link.id)!
    const lowerBound = Math.abs(a.center[0] - b.center[0]) + Math.abs(a.center[1] - b.center[1])
    if (lowerBound > link.max_route_mm + 1e-8) {
      throw new RuleError(`${link.id} port Manhattan lower bound ${pyFixed(lowerBound, 2)} mm exceeds reach`)
    }
    const [length, path] = routeGrid(s, boxes, a, b)
    if (length > link.max_route_mm + 1e-8) {
      throw new RuleError(`${link.id} route ${pyFixed(length, 2)} mm exceeds ${pyFixed(link.max_route_mm, 2)} mm`)
    }
    routes[link.id] = {
      from: link.from, to: link.to, bandwidthGbS: link.gb_s, requiredPortMm: link.gb_s / density,
      fromPort: a.center, toPort: b.center, fromNormal: a.normal, toNormal: b.normal,
      routeLengthMm: length, limitMm: link.max_route_mm, pathGrid: path,
    }
    weighted += link.gb_s * length
  }
  const cap = s.port_rule.total_bandwidth_weighted_route_limit_gb_s_mm
  if (weighted > cap + 1e-8) {
    throw new RuleError(`total bandwidth-weighted route ${pyFixed(weighted, 1)} exceeds ${pyFixed(cap, 1)} GB/s·mm`)
  }
  return { routes, dieEdgeCapacity, weightedRouteGbSmm: pyRound(weighted, 2), weightedBudget: weighted, routeLimitGbSmm: cap }
}

/** Reproduces geometry.validate_layout(spec, xy, check_routes=True, wire_routes_grid=None). */
export function validateLayout(layout: Layout, s: ChallengeSpec = spec): ValidateResult {
  try {
    return { ok: true, ...validateOrThrow(s, layout) }
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, reason: e.message }
    throw e
  }
}

/** Mirrors verify_submission.parse_submission for a parsed JSON value (wire_routes_grid is not interpreted). */
export function parseSubmission(
  raw: unknown,
  s: ChallengeSpec = spec,
): { ok: true; layout: Layout } | { ok: false; reason: string } {
  const topErr = 'top-level keys must be placements_mm and optional wire_routes_grid'
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: topErr }
  const keys = Object.keys(raw)
  if (!keys.includes('placements_mm') || !keys.every((k) => k === 'placements_mm' || k === 'wire_routes_grid')) {
    return { ok: false, reason: topErr }
  }
  const placements = (raw as Record<string, unknown>).placements_mm
  const dieNames = Object.keys(s.dies)
  if (typeof placements !== 'object' || placements === null || Array.isArray(placements)
    || Object.keys(placements).length !== dieNames.length || !dieNames.every((n) => n in placements)) {
    return { ok: false, reason: 'placements_mm must contain exactly G0–G3 and H0–H3' }
  }
  const layout: Layout = {}
  for (const [die, xy] of Object.entries(placements as Record<string, unknown>)) {
    if (!Array.isArray(xy) || xy.length !== 2) return { ok: false, reason: `${die} must have a two-number [x,y] lower-left origin` }
    for (let i = 0; i < 2; i++) {
      if (typeof xy[i] !== 'number' || !Number.isFinite(xy[i])) return { ok: false, reason: `${die}[${i}] must be a finite number` }
    }
    layout[die] = [xy[0] as number, xy[1] as number]
  }
  return { ok: true, layout }
}
