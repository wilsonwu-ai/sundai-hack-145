import './styles.css'
import type { HistoryPoint, Layout, OptimizeProgress, OptimizeResult, SolveResult } from '../contracts'
import { solve } from '../engine/solver'
import { PKG, WORKLOADS, applyWorkload, cloneLayout, defaultLayout } from '../engine/presets'
import { WIRE_BUDGET, checkLegal, wireLength } from '../engine/constraints'
import { optimize, optimizeSolverOnly } from '../engine/optimize'
import { HeatMap, T_MAX, T_MIN, gradientCss } from './heatmap'
import { renderChart, type Series } from './chart'
import { attachDrag } from './drag'

const REPO = 'https://github.com/wilsonwu-ai/sundai-hack-145'
const BUDGET = 150
const H_COLD = PKG.hEff
const H_MICRO = 60000
const STORE_KEY = 'chipletchill.best.v1'

const PHASES: Record<OptimizeProgress['phase'], string> = {
  sampling: 'Sampling layouts with the full solver',
  training: 'Training the surrogate',
  searching: 'Surrogate searching thousands of layouts',
  verifying: 'Full solver verifying the best candidate',
  done: 'Done',
}

const fmt = (n: number): string => n.toFixed(1)

function loadBest(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const o: unknown = JSON.parse(raw)
    return o && typeof o === 'object' ? (o as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function saveBest(m: Record<string, number>): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(m))
  } catch {
    /* storage unavailable: ignore */
  }
}

function bestSeries(h: HistoryPoint[]): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  let best = Infinity
  for (const p of h) {
    if (p.verified == null) continue
    best = Math.min(best, p.verified)
    pts.push({ x: p.solverCalls, y: best })
  }
  return pts
}

export function mountApp(root: HTMLElement): void {
  const ticks = [95, 80, 65, 50, 35]
  root.innerHTML = `
  <div class="shell">
    <header class="top">
      <div>
        <h1>ChipletChill</h1>
        <p class="tag">Train a thermal surrogate in your browser, then let it find the coolest chiplet layout for a 1.36 kW 2035 GPU.</p>
      </div>
      <nav class="links" aria-label="Project links">
        <a href="explainer.html">How it works (ELI5)</a>
        <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>
      </nav>
    </header>

    <main class="layout">
      <section class="stage" aria-label="Package heat map">
        <p class="headline" data-testid="headline">Drag the chiplets. Can you beat the AI?</p>
        <div class="map-row">
          <div class="map-wrap"><canvas id="map" role="img" aria-label="Heat map of the 60 by 60 millimetre package with chiplets"></canvas></div>
          <div class="cbar" aria-hidden="true">
            <div class="cbar-grad" style="background:${gradientCss()}"></div>
            ${ticks
              .map((t) => `<span style="bottom:${((t - T_MIN) / (T_MAX - T_MIN)) * 100}%">${t}</span>`)
              .join('')}
          </div>
        </div>
        <p class="legend"><span class="k k-c">C compute</span><span class="k k-m">M HBM</span><span class="k k-i">IO</span><span class="scale">Colour scale fixed at ${T_MIN} to ${T_MAX} °C</span></p>
      </section>

      <section class="panel" aria-label="Controls and results">
        <div class="readout" aria-live="polite">
          <div class="peak-label">Peak temperature</div>
          <div class="peak" id="tmax" data-testid="tmax">--</div>
          <div class="legal" id="legal" data-testid="legal">--</div>
        </div>
        <div class="wirebox">
          <div class="row"><span>Wire length</span><span id="wiretext" class="mono"></span></div>
          <div class="bar" data-testid="wire" id="wire" role="progressbar" aria-label="Wire length used" aria-valuemin="0" aria-valuemax="100"><div class="fill" id="wirefill"></div></div>
        </div>
        <p class="best mono" id="best"></p>

        <div class="fields">
          <label>Workload
            <select id="workload" data-testid="workload">${WORKLOADS.map((w) => `<option value="${w.id}">${w.label}</option>`).join('')}</select>
          </label>
          <p class="blurb" id="blurb"></p>
          <label>Cooling
            <select id="cooling" data-testid="cooling">
              <option value="${H_COLD}">Cold plate (h = 20,000 W/m²K)</option>
              <option value="${H_MICRO}">In-chip microfluidics (h = 60,000 W/m²K)</option>
            </select>
          </label>
        </div>

        <div class="buttons">
          <button id="run" class="primary" data-testid="run" type="button">Run AI optimizer</button>
          <button id="stop" type="button" hidden>Stop</button>
          <button id="reset" type="button">Reset</button>
        </div>

        <div id="progress" class="progress" hidden>
          <p class="phase" id="phase" aria-live="polite"></p>
          <p class="counters mono"><span>Full solves: <b id="csolve">0</b></span><span>Surrogate predictions: <b id="csur">0</b></span></p>
          <svg id="chart" class="chart" data-testid="chart" role="img" aria-label="Best verified peak temperature versus full-solver calls"></svg>
          <p class="chart-legend"><span class="sw sw-a"></span>Surrogate loop <span class="sw sw-b"></span>Solver only (same budget)</p>
        </div>

        <div id="result" class="result" data-testid="result" hidden>
          <h2 id="resulthead"></h2>
          <dl class="stats mono" id="stats"></dl>
          <div class="buttons">
            <button id="toggle" type="button">Show start</button>
            <button id="beat" type="button">Try to beat it</button>
          </div>
        </div>
      </section>
    </main>

    <section class="about" aria-label="What you are looking at">
      <h2>What you're looking at</h2>
      <ul>
        <li>The package is modelled as a 2D heat-spreading plate: each chiplet injects watts, the interposer spreads them sideways and drops heat into the coolant.</li>
        <li>The full solver is the ground truth. It takes about 3 ms per layout.</li>
        <li>The surrogate is a small model trained in your browser. It only proposes layouts; it never gets the last word.</li>
        <li>Every temperature shown here is re-checked by the full solver, and every AI layout stays inside the wire budget.</li>
      </ul>
      <p><a href="${REPO}/blob/main/research/brief.md" target="_blank" rel="noopener">Sources and assumptions (research/brief.md)</a></p>
    </section>

    <footer class="foot">Built at Sundai Hack 145 · MIT CSAIL · 18 Oct 2026 · MIT License</footer>
  </div>`

  const q = <T extends Element>(sel: string): T => {
    const e = root.querySelector<T>(sel)
    if (!e) throw new Error(`missing ${sel}`)
    return e
  }
  const canvas = q<HTMLCanvasElement>('#map')
  const elTmax = q<HTMLElement>('#tmax')
  const elLegal = q<HTMLElement>('#legal')
  const elWire = q<HTMLElement>('#wire')
  const elWireFill = q<HTMLElement>('#wirefill')
  const elWireText = q<HTMLElement>('#wiretext')
  const elBest = q<HTMLElement>('#best')
  const selWork = q<HTMLSelectElement>('#workload')
  const selCool = q<HTMLSelectElement>('#cooling')
  const elBlurb = q<HTMLElement>('#blurb')
  const btnRun = q<HTMLButtonElement>('#run')
  const btnStop = q<HTMLButtonElement>('#stop')
  const btnReset = q<HTMLButtonElement>('#reset')
  const elProgress = q<HTMLElement>('#progress')
  const elPhase = q<HTMLElement>('#phase')
  const elCSolve = q<HTMLElement>('#csolve')
  const elCSur = q<HTMLElement>('#csur')
  const svg = q<SVGSVGElement>('#chart')
  const elResult = q<HTMLElement>('#result')
  const elResultHead = q<HTMLElement>('#resulthead')
  const elStats = q<HTMLElement>('#stats')
  const btnToggle = q<HTMLButtonElement>('#toggle')
  const btnBeat = q<HTMLButtonElement>('#beat')
  const elHeadline = q<HTMLElement>('[data-testid="headline"]')

  const map = new HeatMap(canvas)

  let workloadId = WORKLOADS[0].id
  let hEff = H_COLD
  let mode: 'drag' | 'running' | 'result' = 'drag'
  let showing: 'start' | 'ai' | 'custom' = 'custom'
  let stopRequested = false
  let startLayout: Layout | null = null
  let aiResult: OptimizeResult | null = null
  let grabbed: string | null = null
  let lastRes: SolveResult | null = null
  let rafPending = false

  const workload = () => WORKLOADS.find((w) => w.id === workloadId) ?? WORKLOADS[0]

  const freshLayout = (): Layout => {
    const l = applyWorkload(cloneLayout(defaultLayout()), workload())
    l.pkg = { ...l.pkg, hEff }
    return l
  }

  let layout: Layout = freshLayout()

  const bestKey = (): string => `${workloadId}|${hEff}`

  function render(): void {
    rafPending = false
    const res = solve(layout)
    lastRes = res
    const why = checkLegal(layout)
    const legal = why === null
    map.draw(layout, res, { legal, showLinks: true, highlightId: grabbed })

    elTmax.textContent = `${fmt(res.tMax)} °C`
    elTmax.classList.toggle('grey', !legal)
    elLegal.textContent = legal ? 'Legal' : why
    elLegal.classList.toggle('bad', !legal)
    elLegal.classList.toggle('ok', legal)

    const wl = wireLength(layout)
    const pct = (wl / WIRE_BUDGET) * 100
    elWireFill.style.width = `${Math.min(100, pct)}%`
    elWire.classList.toggle('over', wl > WIRE_BUDGET + 1e-9)
    elWire.setAttribute('aria-valuenow', String(Math.round(Math.min(100, pct))))
    elWireText.textContent = `${fmt(wl)} / ${fmt(WIRE_BUDGET)} mm`

    if (legal && mode !== 'running') {
      const best = loadBest()
      const k = bestKey()
      if (best[k] === undefined || res.tMax < best[k]) {
        best[k] = res.tMax
        saveBest(best)
      }
    }
    const stored = loadBest()[bestKey()]
    let line = stored !== undefined ? `Your best legal score: ${fmt(stored)} °C` : 'Your best legal score: none yet'
    if (aiResult) line += ` · AI: ${fmt(aiResult.bestTMax)} °C`
    elBest.textContent = line
  }

  function schedule(): void {
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(render)
  }

  function setBusy(busy: boolean): void {
    btnRun.disabled = busy
    btnReset.disabled = busy
    selWork.disabled = busy
    selCool.disabled = busy
    btnStop.hidden = !busy
    canvas.style.cursor = busy ? 'default' : 'grab'
  }

  function clearResult(): void {
    aiResult = null
    startLayout = null
    elResult.hidden = true
    elProgress.hidden = true
    elHeadline.textContent = 'Drag the chiplets. Can you beat the AI?'
  }

  function setBlurb(): void {
    elBlurb.textContent = workload().blurb
  }

  function updateToggle(): void {
    btnToggle.textContent = showing === 'ai' ? 'Show start' : 'Show AI layout'
  }

  function showResult(startT: number, ai: OptimizeResult, base: OptimizeResult | null): void {
    const delta = startT - ai.bestTMax
    elHeadline.textContent = `AI-designed 2035 GPU package runs ${fmt(delta)} °C cooler under the same wire budget`
    elResultHead.textContent = `${fmt(delta)} °C cooler, same wire budget`
    const rows: [string, string, string?][] = [
      ['Start peak', `${fmt(startT)} °C`],
      ['AI peak', `${fmt(ai.bestTMax)} °C`, 'ai-tmax'],
      ['Change', `${delta >= 0 ? '-' : '+'}${fmt(Math.abs(delta))} °C`],
      ['Full solver calls', String(ai.solverCalls)],
      ['Surrogate predictions', String(ai.surrogateCalls)],
      ['Surrogate MAE', `${ai.surrogateMAE.toFixed(2)} °C`],
      ['vs solver-only at same budget', base ? `${fmt(base.bestTMax)} °C` : 'skipped (stopped early)'],
    ]
    elStats.innerHTML = rows
      .map(([k, v, id]) => `<div><dt>${k}</dt><dd${id ? ` data-testid="${id}"` : ''}>${v}</dd></div>`)
      .join('')
    elResult.hidden = false
    updateToggle()
  }

  async function run(): Promise<void> {
    if (mode === 'running') return
    const startL = checkLegal(layout) === null ? cloneLayout(layout) : freshLayout()
    const startT = solve(startL).tMax
    startLayout = cloneLayout(startL)
    aiResult = null
    elResult.hidden = true
    elHeadline.textContent = 'The AI is working...'
    layout = cloneLayout(startL)
    mode = 'running'
    showing = 'custom'
    stopRequested = false
    setBusy(true)
    elProgress.hidden = false
    let aSeries: Series['pts'] = []
    let bSeries: Series['pts'] = []
    const draw = (): void =>
      renderChart(
        svg,
        [
          { label: 'Surrogate loop', color: 'var(--accent)', pts: aSeries },
          { label: 'Solver only (same budget)', color: 'var(--muted-line)', pts: bSeries },
        ],
        BUDGET,
      )
    draw()
    schedule()

    let ai: OptimizeResult | null = null
    let base: OptimizeResult | null = null
    try {
      ai = await optimize(cloneLayout(startL), {
        solverBudget: BUDGET,
        surrogateBudget: 40000,
        seed: 1,
        shouldStop: () => stopRequested,
        onProgress: (p) => {
          elPhase.textContent = PHASES[p.phase]
          elCSolve.textContent = String(p.solverCalls)
          elCSur.textContent = String(p.surrogateCalls)
          aSeries = bestSeries(p.history)
          draw()
          layout = cloneLayout(p.bestLayout)
          schedule()
        },
      })
      layout = cloneLayout(ai.best)
      aSeries = bestSeries(ai.history)
      draw()
      schedule()
      if (!stopRequested) {
        base = await optimizeSolverOnly(cloneLayout(startL), {
          solverBudget: BUDGET,
          surrogateBudget: 40000,
          seed: 1,
          shouldStop: () => stopRequested,
          onProgress: (p) => {
            elPhase.textContent = `Solver-only baseline: ${p.solverCalls} of ${BUDGET} full solves`
            bSeries = bestSeries(p.history)
            draw()
          },
        })
        bSeries = bestSeries(base.history)
        draw()
      }
    } catch (err) {
      elPhase.textContent = `Optimizer error: ${err instanceof Error ? err.message : String(err)}`
    }

    mode = ai ? 'result' : 'drag'
    setBusy(false)
    if (ai) {
      aiResult = ai
      layout = cloneLayout(ai.best)
      showing = 'ai'
      elPhase.textContent = 'Done'
      showResult(startT, ai, base)
    } else {
      layout = cloneLayout(startL)
      elHeadline.textContent = 'Drag the chiplets. Can you beat the AI?'
    }
    schedule()
  }

  attachDrag(map, {
    getLayout: () => layout,
    enabled: () => mode !== 'running',
    onGrab: (id) => {
      grabbed = id
      if (id && mode === 'result') {
        mode = 'drag'
        showing = 'custom'
        updateToggle()
      }
      schedule()
    },
    onMove: (id, x, y) => {
      const c = layout.chiplets.find((k) => k.id === id)
      if (!c) return
      c.x = x
      c.y = y
      schedule()
    },
    onEnd: () => schedule(),
  })

  selWork.addEventListener('change', () => {
    workloadId = selWork.value
    layout = applyWorkload(cloneLayout(layout), workload())
    clearResult()
    mode = 'drag'
    setBlurb()
    schedule()
  })
  selCool.addEventListener('change', () => {
    hEff = Number(selCool.value)
    const l = cloneLayout(layout)
    l.pkg.hEff = hEff
    layout = l
    clearResult()
    mode = 'drag'
    schedule()
  })
  btnReset.addEventListener('click', () => {
    layout = freshLayout()
    clearResult()
    mode = 'drag'
    showing = 'custom'
    schedule()
  })
  btnRun.addEventListener('click', () => void run())
  btnStop.addEventListener('click', () => {
    stopRequested = true
  })
  btnToggle.addEventListener('click', () => {
    if (!startLayout || !aiResult) return
    if (showing === 'ai') {
      layout = cloneLayout(startLayout)
      showing = 'start'
    } else {
      layout = cloneLayout(aiResult.best)
      showing = 'ai'
    }
    mode = 'result'
    updateToggle()
    schedule()
  })
  btnBeat.addEventListener('click', () => {
    if (!aiResult) return
    layout = cloneLayout(aiResult.best)
    mode = 'drag'
    showing = 'custom'
    updateToggle()
    schedule()
  })

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (map.resize() && lastRes) schedule()
    }).observe(canvas)
  }
  window.addEventListener('resize', () => schedule())

  setBlurb()
  setBusy(false)
  render()
}
