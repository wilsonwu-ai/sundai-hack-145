#!/usr/bin/env python3
"""Surrogate-in-the-loop search for the official Track 2 challenge.

Surrogate = low-fi physics model (lowfi.py, ~0.6 s per layout, all 5 workloads)
            + learned affine correction per (die class, workload), refit on every
            HotSpot result in state/official/samples.jsonl.
Loop      = simulated annealing chains on the surrogate -> top distinct candidates
            -> local HotSpot judge (ground truth) -> append -> refit -> repeat.

  python3 loop.py --rounds 4 --chains 6 --steps 200 --verify 6
"""

import argparse
import json
import math
import random
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lowfi as L  # noqa: E402
import train_and_search as TS  # noqa: E402

AMB = L.AMB
REF_G, REF_H = 104.59, 97.68
SAMPLES = TS.OUT / "samples.jsonl"
GPUS = [d for d in L.SPEC["dies"] if d.startswith("G")]
HBMS = [d for d in L.SPEC["dies"] if d.startswith("H")]


def load_rows():
    return [r for r in (json.loads(x) for x in SAMPLES.read_text().splitlines() if x.strip()) if r.get("passed")]


def fit(rows, model):
    """Affine correction hotspot = a*lowfi + b per (class, workload)."""
    data = {}
    for r in rows:
        lf = r.get("_lowfi") or model.evaluate(r["placements_mm"])
        for wl, p in lf.items():
            for d, t in p.items():
                data.setdefault((d[0], wl), []).append((t, r["per_workload"][wl][d]))
    coef = {}
    for key, pts in data.items():
        x, y = np.array(pts).T
        a, b = np.polyfit(x, y, 1)
        coef[f"{key[0]}|{key[1]}"] = (float(a), float(b))
    return coef


def predict(per, coef):
    g = h = -1e9
    for wl, p in per.items():
        for d, t in p.items():
            a, b = coef[f"{d[0]}|{wl}"]
            v = a * t + b
            if d[0] == "G":
                g = max(g, v)
            else:
                h = max(h, v)
    return max((g - AMB) / (REF_G - AMB), (h - AMB) / (REF_H - AMB)), g, h


def mutate(lay, rng, step):
    new = {d: list(v) for d, v in lay.items()}
    r = rng.random()
    if r < 0.12:  # swap two dies of the same class (same size)
        cls = GPUS if rng.random() < 0.5 else HBMS
        a, b = rng.sample(cls, 2)
        new[a], new[b] = new[b], new[a]
    elif r < 0.25:  # shift everything
        dx, dy = rng.gauss(0, step / 2), rng.gauss(0, step / 2)
        for d in new:
            new[d] = [new[d][0] + dx, new[d][1] + dy]
    else:
        for d in rng.sample(list(new), rng.choice([1, 1, 2])):
            new[d] = [new[d][0] + rng.gauss(0, step), new[d][1] + rng.gauss(0, step)]
    return {d: [round(x, 3), round(y, 3)] for d, (x, y) in new.items()}


def chain(args):
    start, coef, steps, seed = args
    rng = random.Random(seed)
    model = L.Model(1.0)
    cur = start
    cur_s = predict(model.evaluate(cur), coef)[0]
    best, best_s = cur, cur_s
    seen = []
    T0 = 0.01
    for k in range(steps):
        T = T0 * (1 - k / steps) + 1e-4
        step = 1.5 * (1 - k / steps) + 0.2
        cand = mutate(cur, rng, step)
        if not TS.legal(cand):
            continue
        s = predict(model.evaluate(cand), coef)[0]
        seen.append((s, cand))
        if s < cur_s or rng.random() < math.exp(-(s - cur_s) / T):
            cur, cur_s = cand, s
            if s < best_s:
                best, best_s = cand, s
    seen.sort(key=lambda t: t[0])
    return best_s, best, seen[:5]


def distinct(cands, k, min_mm=0.3):
    out = []
    for s, lay in sorted(cands, key=lambda t: t[0]):
        if all(max(abs(lay[d][i] - o[d][i]) for d in lay for i in (0, 1)) > min_mm for _, o in out):
            out.append((s, lay))
        if len(out) == k:
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=4)
    ap.add_argument("--chains", type=int, default=6)
    ap.add_argument("--steps", type=int, default=200)
    ap.add_argument("--verify", type=int, default=6)
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    model = L.Model(1.0)
    log = (TS.OUT / "loop.jsonl").open("a")
    for rnd in range(a.rounds):
        t0 = time.time()
        rows = load_rows()
        coef = fit(rows, model)
        # in-sample check of the surrogate on everything HotSpot has judged
        pred = np.array([predict(model.evaluate(r["placements_mm"]), coef)[0] for r in rows])
        true = np.array([r["score"] for r in rows])
        mae = float(abs(pred - true).mean())
        order = sorted(rows, key=lambda r: r["score"])
        starts = [order[i % min(len(order), 3)]["placements_mm"] for i in range(a.chains)]
        with Pool(a.chains) as pool:
            res = pool.map(chain, [(s, coef, a.steps, 1000 * rnd + i) for i, s in enumerate(starts)])
        cands = [(s, lay) for s, lay, _ in res] + [c for *_, top in res for c in top]
        picks = distinct(cands, a.verify)
        paths = [TS.write_sub(lay, f"loop_r{rnd}_{i}") for i, (_, lay) in enumerate(picks)]
        n_before = len(rows)
        TS.judge_files(paths, a.jobs, f"loop_r{rnd}")
        new = load_rows()[n_before:]
        got = {Path(r["file"]).name: r["score"] for r in new}
        best_all = min(r["score"] for r in load_rows())
        rec = {"round": rnd, "n_train": n_before, "train_mae": round(mae, 4),
               "predicted": [round(s, 4) for s, _ in picks],
               "hotspot": [got.get(p.name) for p in paths], "best_so_far": best_all,
               "seconds": round(time.time() - t0, 1)}
        log.write(json.dumps(rec) + "\n"); log.flush()
        print("ROUND", json.dumps(rec), flush=True)
    (TS.OUT / "coef.json").write_text(json.dumps(fit(load_rows(), model), indent=1))


if __name__ == "__main__":
    main()
