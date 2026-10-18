import { parseSubmission, routeSegments, spec, validateLayout, type Layout, type ValidateResult } from '../official'
import { evaluateLowfiDetailed, predictScore, thermalModel, type Coef, type LowfiResult } from '../official/lowfi'
import coefJson from '../official/data/coef.json'
import bestJson from '../official/data/best.json'
import resultsJson from '../official/data/results.json'

const coef = coefJson as unknown as Coef
const best = bestJson as unknown as Layout
interface ResultRow { name: string; score: number; worst_gpu_c: number; worst_hbm_c: number; source: string }
const results = resultsJson as unknown as ResultRow[]

const [IW, IH] = spec.interposer_mm
const DIES = Object.keys(spec.dies)
const WLS = Object.keys(spec.workloads)
const BUDGET = spec.port_rule.total_bandwidth_weighted_route_limit_gb_s_mm
const PITCH = spec.port_rule.route_grid_pitch_mm
const SWAP_MS = 400

const BASELINE: Layout = {
  G0: [7.563, 3.259], H0: [20.934, 3.584], G1: [33.272, 2.856], H1: [34.12, 15.888],
  G2: [33.072, 27.366], H2: [20.77, 27.311], G3: [7.994, 27.611], H3: [8.748, 15.163],
}
const PRESETS: { id: string; label: string; layout: Layout }[] = [
  { id: 'baseline', label: 'Baseline (organizer example)', layout: BASELINE },
  ...Object.entries(spec.example_layouts_mm).map(([k, v]) => ({ id: k, label: `Spec example: ${k}`, layout: v as Layout })),
  { id: 'best', label: 'Best public layout', layout: best },
]

// Layouts HotSpot has judged through the organizer pipeline (64 x 64). The surrogate cannot rank
// layouts this close, so when one of these is loaded the verified number is shown next to the estimate.
const VERIFIED: { layout: Layout; score: number; gpu: number; hbm: number }[] = [
  { layout: BASELINE, score: 1.0, gpu: 104.59, hbm: 97.68 },
  { layout: best, score: 0.96582, gpu: 101.87, hbm: 95.16 },
]
const sameLayout = (a: Layout, b: Layout) =>
  Object.keys(b).every((d) => a[d] && Math.abs(a[d][0] - b[d][0]) < 5e-4 && Math.abs(a[d][1] - b[d][1]) < 5e-4)

const clone = (l: Layout): Layout => Object.fromEntries(Object.entries(l).map(([d, p]) => [d, [p[0], p[1]] as [number, number]]))
const r3 = (x: number) => Math.round(x * 1000) / 1000

// inferno-like ramp
const RAMP: [number, number, number][] = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]]
function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  return [0, 1, 2].map((c) => RAMP[i][c] + (RAMP[i + 1][c] - RAMP[i][c]) * f) as [number, number, number]
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
  <header>
    <h1>ChipletChill: beat the hotspot</h1>
    <p>Drag 4 GPUs and 4 HBM stacks around a 52 x 42 mm interposer, keep every rule legal, and see a live thermal score against the organizer baseline (lower is better, below 1 beats it). <a href="./explainer.html">How it works</a></p>
  </header>
  <div class="grid">
    <section class="card" id="stage-card">
      <h2>Interposer (to scale, drag dies)</h2>
      <div class="stage"><canvas id="cv" data-testid="heatmap" aria-label="Interposer layout and heat map"></canvas></div>
      <div class="legend">
        <span><i class="sw" style="background:var(--gpu)"></i>GPU</span>
        <span><i class="sw" style="background:var(--hbm)"></i>HBM</span>
        <span><i class="sw" style="background:#7aa2ff"></i>primary link</span>
        <span><i class="sw" style="background:#e879f9"></i>secondary link</span>
        <span>dashed: cooling contact</span>
        <span id="range"></span>
      </div>
      <p class="note">Heat map: die-plane field from the low-fidelity solver for the selected workload (surrogate estimate).</p>
    </section>
    <section class="card" id="side">
      <h2>Live result</h2>
      <div id="legal" data-testid="legal" class="badge ok">LEGAL</div>
      <div class="kpis">
        <div class="kpi"><small>Score (surrogate estimate)</small><b id="score" data-testid="score">-</b></div>
        <div class="kpi"><small>Worst GPU C</small><b id="gpu" data-testid="gpu">-</b></div>
        <div class="kpi"><small>Worst HBM C</small><b id="hbm" data-testid="hbm">-</b></div>
      </div>
      <p id="verified" data-testid="verified" class="badge ok" hidden></p>
      <p class="note">Score is the worse of GPU and HBM rise over ambient, relative to the baseline. Estimated from a fast model plus a fitted correction, not a HotSpot run. The estimate finds the right neighbourhood but cannot rank layouts within about 0.03 of each other; that last step is done with HotSpot.</p>
      <div style="margin-top:10px">
        <div id="budget" data-testid="budget">-</div>
        <div class="bar" id="budgetbar"><i></i></div>
      </div>
      <div style="margin-top:12px">
        <label class="field" for="workload">Workload</label>
        <select id="workload" data-testid="workload">${WLS.map((w) => `<option value="${w}">${w.replace(/_/g, ' ')}</option>`).join('')}</select>
      </div>
      <table style="margin-top:10px"><thead><tr><th>Die</th><th class="n">Peak C (surrogate estimate)</th></tr></thead><tbody id="peaks"></tbody></table>
      <div class="row">
        <select id="preset-select" aria-label="Preset">${PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</select>
        <button id="preset" data-testid="preset" type="button">Load preset</button>
      </div>
      <div class="row">
        <button id="download" data-testid="download" type="button">Download submission.json</button>
        <label class="btn" for="upload">Upload submission.json</label>
        <input id="upload" data-testid="upload" type="file" accept="application/json,.json" />
      </div>
      <div class="err" id="msg" role="status"></div>
    </section>
    <section class="card full">
      <h2>HotSpot-verified results</h2>
      <p class="note" style="margin:0 0 6px">HotSpot, 64x64, organizer pipeline.</p>
      <table data-testid="results"><thead><tr><th>Layout</th><th class="n">Score</th><th class="n">Worst GPU C</th><th class="n">Worst HBM C</th><th>Source</th></tr></thead>
      <tbody>${results.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.score.toFixed(3)}</td><td class="n">${r.worst_gpu_c.toFixed(2)}</td><td class="n">${r.worst_hbm_c.toFixed(2)}</td><td>${esc(r.source)}</td></tr>`).join('')}</tbody></table>
    </section>
  </div>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!
  const cv = $<HTMLCanvasElement>('cv')
  const ctx = cv.getContext('2d')!
  const heatCanvas = document.createElement('canvas')

  let layout: Layout = clone(BASELINE)
  let valid: ValidateResult = validateLayout(layout)
  let lf: LowfiResult | null = null
  let lfKey = ''
  let wl = WLS[0]
  let dragging: { die: string; dx: number; dy: number } | null = null
  let lastHeavy = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let scale = 1

  const toMm = (e: PointerEvent): [number, number] => {
    const r = cv.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * IW, (1 - (e.clientY - r.top) / r.height) * IH]
  }

  function resize() {
    const r = cv.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.max(1, Math.round(r.width * dpr))
    cv.height = Math.max(1, Math.round(r.height * dpr))
    scale = cv.width / IW
    draw()
  }

  function draw() {
    const W = cv.width, Hh = cv.height
    const X = (mm: number) => mm * scale
    const Y = (mm: number) => Hh - mm * scale
    ctx.clearRect(0, 0, W, Hh)
    ctx.fillStyle = '#05080c'
    ctx.fillRect(0, 0, W, Hh)
    const rangeEl = $('range')
    if (lf && valid.ok) {
      const f = lf.fields[wl]
      let lo = Infinity, hi = -Infinity
      for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v }
      heatCanvas.width = lf.nx; heatCanvas.height = lf.ny
      const hc = heatCanvas.getContext('2d')!
      const img = hc.createImageData(lf.nx, lf.ny)
      for (let j = 0; j < lf.ny; j++) for (let i = 0; i < lf.nx; i++) {
        const [r, g, b] = ramp((f[j * lf.nx + i] - lo) / Math.max(1e-9, hi - lo))
        const o = ((lf.ny - 1 - j) * lf.nx + i) * 4
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255
      }
      hc.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(heatCanvas, 0, 0, W, Hh)
      rangeEl.textContent = `heat ${lo.toFixed(1)} to ${hi.toFixed(1)} C (low-fi)`
    } else {
      rangeEl.textContent = ''
    }
    // cooling contact
    const [cx, cy, cw, ch] = thermalModel.cooling_contact_rect_mm
    ctx.save()
    ctx.setLineDash([6 * (scale / 8), 4 * (scale / 8)])
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = Math.max(1, scale / 8)
    ctx.strokeRect(X(cx), Y(cy + ch), cw * scale, ch * scale)
    ctx.restore()
    // wires
    if (valid.ok) {
      ctx.lineWidth = Math.max(1.5, scale * 0.28)
      ctx.lineJoin = 'round'
      for (const [id, route] of Object.entries(valid.routes)) {
        ctx.strokeStyle = id.startsWith('P') ? '#7aa2ff' : '#e879f9'
        ctx.beginPath()
        for (const [a, b] of routeSegments(route, PITCH)) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])) }
        ctx.stroke()
      }
    }
    // dies
    ctx.font = `600 ${Math.max(10, scale * 1.9)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const d of DIES) {
      const [x, y] = layout[d]
      const [w, h] = spec.dies[d].size_mm
      const col = spec.dies[d].kind === 'GPU' ? '255,138,61' : '61,214,198'
      ctx.fillStyle = `rgba(${col},0.28)`
      ctx.strokeStyle = `rgb(${col})`
      ctx.lineWidth = Math.max(1.5, scale / 5) * (dragging?.die === d ? 1.8 : 1)
      ctx.fillRect(X(x), Y(y + h), w * scale, h * scale)
      ctx.strokeRect(X(x), Y(y + h), w * scale, h * scale)
      ctx.fillStyle = '#fff'
      ctx.fillText(d, X(x + w / 2), Y(y + h / 2))
    }
  }

  function fmt(n: number, d = 2) { return n.toFixed(d) }

  function renderNumbers() {
    const legalEl = $('legal')
    const dl = $<HTMLButtonElement>('download')
    const stage = $('side')
    if (!valid.ok) {
      legalEl.className = 'badge bad'
      legalEl.textContent = `ILLEGAL: ${valid.reason}`
      for (const id of ['score', 'gpu', 'hbm']) $(id).textContent = '-'
      $('score').className = ''
      $('budget').textContent = 'Budget: n/a for an illegal layout'
      $('budgetbar').className = 'bar'
      $('budgetbar').firstElementChild!.setAttribute('style', 'width:0')
      $('peaks').innerHTML = ''
      dl.disabled = true
      return
    }
    legalEl.className = 'badge ok'
    legalEl.textContent = 'LEGAL'
    dl.disabled = false
    const used = valid.weightedBudget
    $('budget').textContent = `Budget: ${fmt(used, 1)} / ${BUDGET} GB/s·mm (${fmt((used / BUDGET) * 100, 1)}%)`
    $('budgetbar').className = 'bar' + (used > BUDGET ? ' over' : '')
    $('budgetbar').firstElementChild!.setAttribute('style', `width:${Math.min(100, (used / BUDGET) * 100)}%`)
    const fresh = lf && lfKey === key()
    stage.classList.toggle('stale', !fresh)
    const v = VERIFIED.find((x) => sameLayout(layout, x.layout))
    const vEl = $('verified')
    vEl.hidden = !v
    if (v) vEl.textContent = `HotSpot verified (organizer pipeline, 64 x 64): score ${fmt(v.score, 5)}, GPU ${fmt(v.gpu, 2)} C, HBM ${fmt(v.hbm, 2)} C`
    if (lf) {
      const p = predictScore(lf.per, coef)
      $('score').textContent = fmt(p.score, 3)
      $('score').className = p.score < 1 ? 'win' : 'lose'
      $('gpu').textContent = fmt(p.gpu, 1)
      $('hbm').textContent = fmt(p.hbm, 1)
      $('peaks').innerHTML = DIES.map((d) => {
        const [a, b] = coef[`${d[0]}|${wl}`]
        return `<tr><td>${d}</td><td class="n">${fmt(a * lf!.per[wl][d] + b, 1)}</td></tr>`
      }).join('')
    }
  }

  const key = () => JSON.stringify(layout)

  function heavy() {
    timer = undefined
    valid = validateLayout(layout)
    if (valid.ok) {
      lastHeavy = performance.now()
      lf = evaluateLowfiDetailed(layout, valid)
      lfKey = key()
    }
    renderNumbers()
    draw()
  }

  function schedule(immediate: boolean) {
    if (timer) { clearTimeout(timer); timer = undefined }
    const wait = immediate ? 0 : Math.max(0, SWAP_MS - (performance.now() - lastHeavy))
    if (wait === 0) heavy()
    else timer = setTimeout(heavy, wait)
  }

  function setLayout(l: Layout) {
    layout = clone(l)
    valid = validateLayout(layout)
    $('msg').textContent = ''
    renderNumbers()
    draw()
    schedule(true)
  }

  function hit(x: number, y: number): string | null {
    for (const d of [...DIES].reverse()) {
      const [px, py] = layout[d]
      const [w, h] = spec.dies[d].size_mm
      if (x >= px && x <= px + w && y >= py && y <= py + h) return d
    }
    return null
  }

  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = toMm(e)
    const d = hit(x, y)
    if (!d) return
    dragging = { die: d, dx: x - layout[d][0], dy: y - layout[d][1] }
    cv.setPointerCapture(e.pointerId)
    cv.classList.add('dragging')
    e.preventDefault()
  })
  cv.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const [x, y] = toMm(e)
    const [w, h] = spec.dies[dragging.die].size_mm
    layout[dragging.die] = [r3(Math.min(IW - w, Math.max(0, x - dragging.dx))), r3(Math.min(IH - h, Math.max(0, y - dragging.dy)))]
    valid = validateLayout(layout)
    renderNumbers()
    draw()
    if (valid.ok) schedule(false)
  })
  const end = (e: PointerEvent) => {
    if (!dragging) return
    dragging = null
    cv.classList.remove('dragging')
    try { cv.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    schedule(true)
  }
  cv.addEventListener('pointerup', end)
  cv.addEventListener('pointercancel', end)

  $<HTMLSelectElement>('workload').addEventListener('change', (e) => {
    wl = (e.target as HTMLSelectElement).value
    renderNumbers()
    draw()
  })
  $('preset').addEventListener('click', () => {
    const id = $<HTMLSelectElement>('preset-select').value
    setLayout(PRESETS.find((p) => p.id === id)!.layout)
  })
  $('download').addEventListener('click', () => {
    if (!valid.ok) return
    const out: Layout = {}
    for (const d of DIES) out[d] = [r3(layout[d][0]), r3(layout[d][1])]
    const blob = new Blob([JSON.stringify({ placements_mm: out }, null, 2) + '\n'], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'submission.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })
  $<HTMLInputElement>('upload').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement
    const f = input.files?.[0]
    if (!f) return
    try {
      const parsed = parseSubmission(JSON.parse(await f.text()))
      if (!parsed.ok) { $('msg').textContent = `Upload rejected: ${parsed.reason}`; return }
      setLayout(parsed.layout)
      const v = validateLayout(parsed.layout)
      $('msg').textContent = v.ok ? `Loaded ${f.name}` : `Loaded ${f.name}, but it is illegal: ${v.reason}`
    } catch (err) {
      $('msg').textContent = `Upload rejected: ${(err as Error).message}`
    } finally {
      input.value = ''
    }
  })

  new ResizeObserver(resize).observe(cv)
  resize()
  setLayout(BASELINE)
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
