#!/usr/bin/env python3
"""Generate cross-language fixtures from the organizer's Python reference.

Run with plain python3 (numpy required). Reads .official/sim, writes
tests/fixtures/official/*.json. Deterministic: all randomness is seeded.
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIM = ROOT / ".official" / "sim"
OUT = ROOT / "tests" / "fixtures" / "official"
sys.path.insert(0, str(SIM))

from geometry import validate_layout  # noqa: E402
from generate_workloads import generate  # noqa: E402
from interconnect import combined_heat  # noqa: E402

spec = json.loads((SIM / "challenge_spec.json").read_text())
base = generate(spec)["workloads"]
ORDER = ["G0", "H0", "G1", "H1", "G2", "H2", "G3", "H3"]


def category(msg):
    for key, name in (("edge clearance", "edge"), ("violate", "gap"), ("die-edge capacity", "capacity"),
                      ("bandwidth-weighted", "budget"), ("lower bound", "reach"), ("exceeds", "reach"),
                      ("cannot access", "access"), ("no obstacle-free", "noroute"), ("exactly once", "missing")):
        if key in msg:
            if key == "violate" and "mm clearance" not in msg:
                continue
            return name
    return "other"


def verdict(layout):
    try:
        return validate_layout(spec, layout), None
    except ValueError as exc:
        return None, str(exc)


def evaluate(name, layout, pre=None):
    layout = {d: [float(v) for v in layout[d]] for d in layout}
    rec = {"name": name, "layout": layout}
    routing, err = pre if pre is not None else verdict(layout)
    if err is not None:
        rec.update(ok=False, error=err, category=category(err))
        return rec
    routes = {}
    for lid, r in routing["routes"].items():
        routes[lid] = {"path_grid": r["path_grid"], "route_length_mm": r["route_length_mm"],
                       "from_port": list(r["from_port"]), "to_port": list(r["to_port"])}
    unrounded = sum(r["bandwidth_gb_s"] * r["route_length_mm"] for r in routing["routes"].values())
    heat = {}
    for w, data in base.items():
        h = combined_heat(spec, w, data["power_maps_w"], layout, routing)
        heat[w] = {"die_maps_w": {d: m.tolist() for d, m in h["die_maps_w"].items()},
                   "interposer_tiles_w": h["interposer_tiles_w"].tolist(), "total_w": h["total_w"]}
    rec.update(ok=True, category="ok", routes=routes, weighted_route_gb_s_mm=routing["weighted_route_gb_s_mm"],
               weighted_unrounded=unrounded, heat=heat)
    return rec


def perturb(rng, src, sigma):
    return {d: [src[d][0] + rng.uniform(-sigma, sigma), src[d][1] + rng.uniform(-sigma, sigma)] for d in ORDER}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.json"):
        f.unlink()
    ex = spec["example_layouts_mm"]
    fixtures = [evaluate(f"example_{k}", v) for k, v in ex.items()]
    base_sub = json.loads((SIM / "examples" / "baseline" / "submission.json").read_text())
    fixtures.append(evaluate("baseline_submission", base_sub["placements_mm"]))
    rl = json.loads((SIM / "random_layout.json").read_text())["random_layout"]["placements_mm"]
    fixtures.append(evaluate("random_layout", rl))

    rng = random.Random(145)
    # Deterministic hand-built illegal cases, one per rule.
    ring = ex["ring_center"]
    hand = {}
    hand["illegal_overlap"] = {**ring, "H0": list(ring["G0"])}
    hand["illegal_edge_clearance"] = {**ring, "G0": [0.2, ring["G0"][1]]}
    hand["illegal_gap"] = {**ring, "H0": [ring["G0"][0] + 11.5 + 0.5, ring["G0"][1]]}
    hand["illegal_too_long"] = {**ring, "H0": [ring["H0"][0] + 6.0, ring["H0"][1]]}
    hand["illegal_capacity_two_links_one_side"] = {**ring, "H3": [20.5, 15.0]}
    hand["illegal_missing_die"] = {k: v for k, v in ring.items() if k != "H3"}
    hand["illegal_reordered_keys_overlap"] = {k: ({**ring, "G1": list(ring["H1"])})[k] for k in reversed(ORDER)}
    for n, lay in hand.items():
        fixtures.append(evaluate(n, lay))

    # Seeded perturbations across the three examples; bucket by python verdict.
    pool = []
    names = list(ex) + ["ring_spread"]
    for attempt in range(4000):
        src = ex[names[attempt % 4]]
        sigma = rng.choice([0.2, 0.4, 0.65, 1.0, 1.6, 2.5, 4.0, 6.0])
        lay = perturb(rng, src, sigma)
        lay = {d: [round(v[0], 3), round(v[1], 3)] for d, v in lay.items()}
        pool.append((attempt, sigma, lay))
    want = {"ok": 15, "edge": 3, "gap": 3, "reach": 3, "budget": 3, "capacity": 2, "access": 1, "noroute": 1}
    taken = {k: 0 for k in want}
    for attempt, sigma, lay in pool:
        pre = verdict(lay)
        c = "ok" if pre[1] is None else category(pre[1])
        if c in want and taken[c] < want[c]:
            taken[c] += 1
            fixtures.append(evaluate(f"perturb_{attempt:04d}_s{sigma}", lay, pre))
        if all(taken[k] >= want[k] for k in want):
            break
    # Fill any shortfall (e.g. budget) from additional wide-spread samples.
    if any(taken[k] < want[k] for k in want):
        for attempt in range(4000, 40000):
            src = ex[names[attempt % 4]]
            sigma = rng.choice([0.5, 1.0, 1.5, 2.0, 3.0])
            lay = {d: [round(v[0], 3), round(v[1], 3)] for d, v in perturb(rng, src, sigma).items()}
            pre = verdict(lay)
            c = "ok" if pre[1] is None else category(pre[1])
            if c in want and taken[c] < want[c]:
                taken[c] += 1
                fixtures.append(evaluate(f"perturb_{attempt:05d}_s{sigma}", lay, pre))
            if all(taken[k] >= want[k] for k in want):
                break
    # Budget-illegal layouts: hill-climb ring_spread toward the weighted-route cap,
    # then keep moves that cross it while every per-link limit still holds.
    rng2 = random.Random(2026)
    cur = {d: list(v) for d, v in ex["ring_spread"].items()}
    cur_w = 0.0
    found = 0
    for it in range(30000):
        if found >= want["budget"]:
            break
        d = rng2.choice(ORDER)
        cand = {k: list(v) for k, v in cur.items()}
        cand[d] = [round(cur[d][0] + rng2.uniform(-.15, .15), 3), round(cur[d][1] + rng2.uniform(-.15, .15), 3)]
        pre = verdict(cand)
        if pre[1] is None:
            if pre[0]["weighted_route_gb_s_mm"] >= cur_w:
                cur, cur_w = cand, pre[0]["weighted_route_gb_s_mm"]
        elif category(pre[1]) == "budget":
            fixtures.append(evaluate(f"budget_{found}", cand, pre))
            found += 1
            taken["budget"] = found
    print("taken", taken, file=sys.stderr)
    for rec in fixtures:
        (OUT / f"{rec['name']}.json").write_text(json.dumps(rec, separators=(",", ":")))
    legal = sum(r["ok"] for r in fixtures)
    cats = {}
    for r in fixtures:
        cats[r["category"]] = cats.get(r["category"], 0) + 1
    print(f"wrote {len(fixtures)} fixtures: {legal} legal, {len(fixtures)-legal} illegal; categories {cats}")


if __name__ == "__main__":
    main()
