#!/usr/bin/env python3
"""Sub-0.01 C polish on the unrounded HotSpot output (hp.py).

The judge rounds die peaks to 0.01 C, so the last polish stopped on a plateau. Here the
search sees the unrounded peak, screens every candidate on the binding workload only,
re-checks the best few on all five, and accepts a move only when the max over all five
workloads drops. Every layout it writes still has to pass local_judge.py (unmodified
build) before it counts.

  python3 fine.py scan   <start.json> --steps 0.1,0.25 --jobs 14
  python3 fine.py search <start.json> --tag A --step 0.2 --min-step 0.0125 --jobs 14
"""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import hp  # noqa: E402
import train_and_search as TS  # noqa: E402

DIES = ["G0", "H0", "G1", "H1", "G2", "H2", "G3", "H3"]
AXIS = [(1, 0), (-1, 0), (0, 1), (0, -1)]
DIAG = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
OUT = TS.OUT / "fine"


def moved(layout, group, dx, dy):
    lay = {k: list(v) for k, v in layout.items()}
    for d in group:
        lay[d] = [round(lay[d][0] + dx, 4), round(lay[d][1] + dy, 4)]
    return lay


def fmax(per):
    return max(hp.norm(d, t) for p in per.values() for d, t in p.items())


def run_many(pool, layouts, workload):
    """Unrounded peaks for many layouts on one workload; None where HotSpot fails."""
    def job(lay):
        try:
            return hp.one(lay, workload)
        except Exception:  # noqa: BLE001 - a failed run is just a rejected candidate
            return None
    return list(pool.map(job, layouts))


def scan(a, start):
    pool = ThreadPoolExecutor(a.jobs)
    base = hp.one(start, a.workload)
    b = max(hp.norm(d, t) for d, t in base.items())
    cands, labels = [], []
    for s in [float(x) for x in a.steps.split(",")]:
        for die in DIES:
            for ux, uy in AXIS:
                lay = moved(start, [die], ux * s, uy * s)
                if TS.legal(lay):
                    cands.append(lay)
                    labels.append((die, ux * s, uy * s))
    res = run_many(pool, cands, a.workload)
    rows = []
    for lab, r in zip(labels, res):
        if r is None:
            continue
        v = max(hp.norm(d, t) for d, t in r.items())
        rows.append({"move": lab, "delta_norm": v - b, "g0": r["G0"], "dG0_c": r["G0"] - base["G0"]})
    rows.sort(key=lambda r: r["delta_norm"])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"scan_{a.workload}.json").write_text(json.dumps({"base": base, "rows": rows}, indent=1))
    print(f"base G0 {base['G0']:.6f}  legal candidates {len(cands)}")
    for r in rows[:12]:
        print(f"{r['move']}  dG0 {r['dG0_c']:+.6f} C  dnorm {r['delta_norm']:+.7f}")
    print("worst:", [(r["move"], round(r["dG0_c"], 4)) for r in rows[-4:]])


def search(a, start):
    OUT.mkdir(parents=True, exist_ok=True)
    log = (OUT / f"search_{a.tag}.jsonl").open("a")
    pool = ThreadPoolExecutor(a.jobs)
    dies = a.dies.split(",")
    diag = a.diag.split(",") if a.diag else []
    groups = [g.split("+") for g in a.groups.split(";") if g]
    cur = start
    full = hp.evaluate(cur, jobs=5)
    F = fmax(full)
    screen = sorted({w for w, p in full.items() if max(hp.norm(d, t) for d, t in p.items()) >= F - a.margin})
    step = a.step
    last = None
    it = 0
    print(f"start F={F:.7f} G0={full['skewed_compute']['G0']:.6f} screen={screen}", flush=True)
    while step >= a.min_step and it < a.max_iters:
        it += 1
        t0 = time.time()
        moves = []
        for d in dies:
            moves += [([d], ux, uy) for ux, uy in AXIS]
        for d in diag:
            moves += [([d], ux, uy) for ux, uy in DIAG]
        for g in groups:
            moves += [(g, ux, uy) for ux, uy in AXIS + DIAG]
        if last is not None:  # momentum: the last accepted move at double step
            moves.append((last[0], 2 * last[1], 2 * last[2]))
        cands, meta = [], []
        for g, ux, uy in moves:
            lay = moved(cur, g, ux * step, uy * step)
            if TS.legal(lay):
                cands.append(lay)
                meta.append(("+".join(g), ux, uy))
        # screen on the binding workload(s)
        scored = []
        per_w = {w: run_many(pool, cands, w) for w in screen}
        for i in range(len(cands)):
            rs = [per_w[w][i] for w in screen]
            if any(r is None for r in rs):
                continue
            v = max(hp.norm(d, t) for r in rs for d, t in r.items())
            scored.append((v, i))
        scored.sort()
        Fs = max(hp.norm(d, t) for w in screen for d, t in full[w].items())
        # combos: stack the best improving moves that touch different dies (gains from
        # different dies are close to additive, since most of them cut total wire heat)
        good = [i for v, i in scored if v < Fs - 1e-9]
        combos = []
        for k in (2, 3, 4, 6):
            used, lay, n = set(), {kk: list(vv) for kk, vv in cur.items()}, 0
            for i in good:
                g = meta[i][0].split("+")
                if used & set(g):
                    continue
                for d in g:
                    lay[d] = list(cands[i][d])
                used |= set(g)
                n += 1
                if n == k:
                    break
            if n == k and TS.legal(lay) and lay not in combos:
                combos.append(lay)
        if combos:
            base_n = len(cands)
            cands += combos
            meta += [(f"combo{k}", 0, 0) for k, c in zip((2, 3, 4, 6), combos)]
            extra = {w: run_many(pool, combos, w) for w in screen}
            for w in screen:
                per_w[w] += extra[w]
            for j in range(len(combos)):
                rs = [per_w[w][base_n + j] for w in screen]
                if all(r is not None for r in rs):
                    scored.append((max(hp.norm(d, t) for r in rs for d, t in r.items()), base_n + j))
            scored.sort()
        accepted = False
        improving = [i for v, i in scored if v < Fs - 1e-9]
        singles = [i for i in improving if not meta[i][0].startswith("combo")]
        top = improving[: a.topk]
        if singles and singles[0] not in top:  # always double-check the best single move
            top.append(singles[0])
        if top:
            rest = [w for w in hp.WORKLOADS if w not in screen]
            checks = {i: {w: per_w[w][i] for w in screen} for i in top}
            jobs = [(i, w) for i in top for w in rest]
            outs = list(pool.map(lambda iw: hp.one(cands[iw[0]], iw[1]), jobs))
            for (i, w), r in zip(jobs, outs):
                checks[i][w] = r
            best_i = min(top, key=lambda i: fmax(checks[i]))
            Fn = fmax(checks[best_i])
            for i in top:
                (s, w, d, t) = hp.summary(checks[i])[0]
                print(f"   check {meta[i][0]} {meta[i][1]},{meta[i][2]}: full {s:.7f} binds {w} {d} {t:.4f}", flush=True)
            if Fn < F - 1e-9:
                cur, full, F, accepted = cands[best_i], checks[best_i], Fn, True
                g, ux, uy = meta[best_i]
                last = None if g.startswith("combo") else (g.split("+"), ux, uy)
                screen = sorted({w for w, p in full.items()
                                 if max(hp.norm(d, t) for d, t in p.items()) >= F - a.margin})
                path = TS.write_sub(cur, f"fine_{a.tag}_best")
        rec = {"iter": it, "step": step, "cands": len(cands), "accepted": accepted, "F": F,
               "G0": full["skewed_compute"]["G0"], "move": meta[top[0]] if top else None,
               "screen": screen, "layout": cur, "sec": round(time.time() - t0, 1)}
        log.write(json.dumps(rec) + "\n")
        log.flush()
        print(f"it {it} step {step} cands {len(cands)} acc {accepted} F {F:.7f} "
              f"G0 {full['skewed_compute']['G0']:.6f} {rec['sec']}s", flush=True)
        if not accepted:
            step = round(step / 2, 5)
            last = None
    TS.write_sub(cur, f"fine_{a.tag}_best")
    print("BEST", F, json.dumps(cur), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["scan", "search"])
    ap.add_argument("start", type=Path)
    ap.add_argument("--workload", default="skewed_compute")
    ap.add_argument("--steps", default="0.1,0.25")
    ap.add_argument("--tag", default="A")
    ap.add_argument("--step", type=float, default=0.2)
    ap.add_argument("--min-step", type=float, default=0.0125)
    ap.add_argument("--max-iters", type=int, default=200)
    ap.add_argument("--dies", default="G0,H0,G1,H1,G2,H2,G3,H3")
    ap.add_argument("--diag", default="G0,H0,H3")
    ap.add_argument("--groups", default="G0+H0;G0+H3;G0+H0+H3;G0+H0+G1+H1+G2+H2+G3+H3")
    ap.add_argument("--margin", type=float, default=0.0003)
    ap.add_argument("--topk", type=int, default=2)
    ap.add_argument("--jobs", type=int, default=14)
    a = ap.parse_args()
    start = json.loads(a.start.read_text())["placements_mm"]
    scan(a, start) if a.mode == "scan" else search(a, start)


if __name__ == "__main__":
    main()
