#!/usr/bin/env python3
"""Low-fidelity steady-state thermal model of the official Track 2 stack.

Same stack as the organizer's HotSpot setup, discretised on a uniform square grid:
  interposer Si (500 um) -> die plane (150 um, Si under dies, gap material elsewhere)
  -> TIM (20 um, good contact rect vs perimeter) -> Cu spreader (1 mm, 55 mm)
  -> Cu sink (6.9 mm, 60 mm) -> convection (0.08 K/W total) -> ambient.
Power comes from the official combined_heat (die maps + interposer wire/PHY tiles),
so the only approximation is the solver (Jacobi-preconditioned CG, warm-started across workloads).
"""

import json
import sys
from pathlib import Path

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

HERE = Path(__file__).resolve().parent
SIM = HERE.parents[1] / ".official" / "sim"
sys.path.insert(0, str(SIM))

from generate_workloads import generate  # noqa: E402
from geometry import validate_layout  # noqa: E402
from interconnect import combined_heat  # noqa: E402

SPEC = json.loads((SIM / "challenge_spec.json").read_text())
PORTABLE = generate(SPEC)
WORKLOADS = list(PORTABLE["workloads"])
TM = SPEC["thermal_model"]
W, H = SPEC["interposer_mm"]
K_SI = 1 / TM["thermal_resistivity_si_mK_per_W"]
K_GAP = 1 / TM["thermal_resistivity_gap_mK_per_W"]
K_TIM_IN = 1 / TM["thermal_resistivity_tim_mK_per_W"]
K_TIM_OUT = 1 / TM["outside_contact_resistivity_mK_per_W"]
K_CU = 400.0
T_IP, T_DIE, T_TIM = (TM[k] * 1e-6 for k in ("interposer_si_thickness_um", "die_si_thickness_um", "tim_thickness_um"))
T_SPR, T_SINK = 1e-3, 6.9e-3
S_SPR, S_SINK = TM["spreader_side_mm"], TM["sink_side_mm"]
R_CONV = TM["cooling_resistance_K_per_W"]
AMB = TM["ambient_c"]


def cover(boxes, xs0, ys0, h):
    """Fraction of each cell (rows=y, cols=x) covered by the union of disjoint boxes."""
    f = np.zeros((len(ys0), len(xs0)))
    for x0, y0, x1, y1 in boxes:
        ox = np.clip(np.minimum(xs0 + h, x1) - np.maximum(xs0, x0), 0, None) / h
        oy = np.clip(np.minimum(ys0 + h, y1) - np.maximum(ys0, y0), 0, None) / h
        f += np.outer(oy, ox)
    return np.clip(f, 0, 1)


class Model:
    def __init__(self, h=1.0):
        self.h = h
        self.nx, self.ny = int(round(W / h)), int(round(H / h))
        self.ns = int(round(S_SINK / h))
        # chip origin inside the sink grid (chip centred under sink)
        self.ox = int(round((S_SINK - W) / 2 / h))
        self.oy = int(round((S_SINK - H) / 2 / h))
        lo = int(round((S_SINK - S_SPR) / 2 / h))
        self.spr_mask = np.zeros((self.ns, self.ns), bool)
        self.spr_mask[lo:lo + int(round(S_SPR / h)), lo:lo + int(round(S_SPR / h))] = True
        self.xs0 = np.arange(self.nx) * h
        self.ys0 = np.arange(self.ny) * h
        cx, cy, cw, ch = TM["cooling_contact_rect_mm"]
        fc = cover([(cx, cy, cx + cw, cy + ch)], self.xs0, self.ys0, h)
        self.k_tim = fc * K_TIM_IN + (1 - fc) * K_TIM_OUT

    def _system(self, layout):
        h = self.h * 1e-3
        A = h * h
        nx, ny, ns = self.nx, self.ny, self.ns
        nc = nx * ny
        boxes = {}
        for d, (x, y) in layout.items():
            w, hh = SPEC["dies"][d]["size_mm"]
            boxes[d] = (x, y, x + w, y + hh)
        fd = cover(list(boxes.values()), self.xs0, self.ys0, self.h)
        k_die = fd * K_SI + (1 - fd) * K_GAP
        # node blocks: 0 interposer, 1 die, 2 tim (chip grid), 3 spreader, 4 sink (sink grid)
        spr_idx = -np.ones((ns, ns), int)
        spr_idx[self.spr_mask] = np.arange(self.spr_mask.sum())
        nspr = int(self.spr_mask.sum())
        off = [0, nc, 2 * nc, 3 * nc, 3 * nc + nspr]
        N = 3 * nc + nspr + ns * ns
        I, J, G = [], [], []

        def link(i, j, g):
            i, j = np.asarray(i).ravel(), np.asarray(j).ravel()
            I.append(i); J.append(j); G.append(np.broadcast_to(np.asarray(g, float), i.shape).ravel())

        def lateral(base, kmap, t, shape, idx=None):
            ky, kx = shape
            ids = (np.arange(ky * kx).reshape(ky, kx) + base) if idx is None else idx
            for (a, b, ka, kb) in ((ids[:, :-1], ids[:, 1:], kmap[:, :-1], kmap[:, 1:]),
                                   (ids[:-1, :], ids[1:, :], kmap[:-1, :], kmap[1:, :])):
                g = 2 * ka * kb / (ka + kb) * t  # harmonic mean, square cells
                m = (a >= 0) & (b >= 0)
                link(a[m], b[m], np.broadcast_to(g, a.shape)[m])

        ones = np.ones((ny, nx))
        lateral(off[0], K_SI * ones, T_IP, (ny, nx))
        lateral(off[1], k_die, T_DIE, (ny, nx))
        lateral(off[2], self.k_tim, T_TIM, (ny, nx))
        kspr = np.full((ns, ns), K_CU)
        sidx = np.where(spr_idx >= 0, spr_idx + off[3], -1)
        lateral(0, kspr, T_SPR, (ns, ns), idx=sidx)
        lateral(off[4], kspr, T_SINK, (ns, ns))
        chip = np.arange(nc)
        rv = lambda t1, k1, t2, k2: 1 / (t1 / (2 * k1 * A) + t2 / (2 * k2 * A))
        g01 = rv(T_IP, K_SI, T_DIE, k_die.ravel())
        g12 = rv(T_DIE, k_die.ravel(), T_TIM, self.k_tim.ravel())
        # TIM -> spreader cell directly above
        jj, ii = np.divmod(chip, nx)
        sp_cell = spr_idx[jj + self.oy, ii + self.ox]
        g23 = rv(T_TIM, self.k_tim.ravel(), T_SPR, K_CU)
        link(off[0] + chip, off[1] + chip, g01)
        link(off[1] + chip, off[2] + chip, g12)
        link(off[2] + chip, off[3] + sp_cell, g23)
        g34 = rv(T_SPR, K_CU, T_SINK, K_CU)
        sj, si = np.nonzero(self.spr_mask)
        link(off[3] + np.arange(nspr), off[4] + sj * ns + si, g34)
        I, J, G = np.concatenate(I), np.concatenate(J), np.concatenate(G)
        gconv = 1 / R_CONV / (ns * ns)
        diag = off[4] + np.arange(ns * ns)
        rows = np.concatenate([I, J, I, J, diag])
        cols = np.concatenate([I, J, J, I, diag])
        vals = np.concatenate([G, G, -G, -G, np.full(ns * ns, gconv)])
        M = sp.csc_matrix((vals, (rows, cols)), shape=(N, N))
        return M, boxes, off

    def _power(self, layout, routing, wl, boxes):
        heat = combined_heat(SPEC, wl, PORTABLE["workloads"][wl]["power_maps_w"], layout, routing)
        q_die = np.zeros((self.ny, self.nx))
        n = SPEC["power_pixels_per_die_side"]
        for d, m in heat["die_maps_w"].items():
            x0, y0, x1, y1 = boxes[d]
            dx, dy = (x1 - x0) / n, (y1 - y0) / n
            px = x0 + np.arange(n) * dx
            py = y0 + np.arange(n) * dy
            # overlap matrix pixel->cell, separable in x and y
            ox = np.clip(np.minimum(px[:, None] + dx, self.xs0[None] + self.h) - np.maximum(px[:, None], self.xs0[None]), 0, None) / dx
            oy = np.clip(np.minimum(py[:, None] + dy, self.ys0[None] + self.h) - np.maximum(py[:, None], self.ys0[None]), 0, None) / dy
            q_die += oy.T @ np.asarray(m) @ ox
        q_ip = np.asarray(heat["interposer_tiles_w"])
        if q_ip.shape != (self.ny, self.nx):  # tiles are 1 mm; resample by repetition
            r = int(round(1 / self.h))
            q_ip = np.kron(q_ip, np.ones((r, r))) / (r * r)
        return q_die, q_ip

    def evaluate(self, layout, routing=None):
        """Per-workload, per-die peak temperature (C) in the die plane."""
        if routing is None:
            routing = validate_layout(SPEC, layout)
        M, boxes, off = self._system(layout)
        # Jacobi-scaled CG: SuperLU is pathologically slow on this high-contrast SPD system
        dinv = 1 / np.sqrt(M.diagonal())
        Ms = (sp.diags(dinv) @ M @ sp.diags(dinv)).tocsr()
        x0 = None
        nc = self.nx * self.ny
        out = {}
        masks = {d: cover([b], self.xs0, self.ys0, self.h) > 0.5 for d, b in boxes.items()}
        for wl in WORKLOADS:
            q_die, q_ip = self._power(layout, routing, wl, boxes)
            b = np.zeros(M.shape[0])
            b[off[0]:off[0] + nc] = q_ip.ravel()
            b[off[1]:off[1] + nc] = q_die.ravel()
            y, info = spla.cg(Ms, b * dinv, x0=x0, rtol=1e-9, maxiter=20000)
            if info:
                raise RuntimeError(f"CG did not converge ({info})")
            x0 = y
            T = (y * dinv)[off[1]:off[1] + nc].reshape(self.ny, self.nx) + AMB
            out[wl] = {d: float(T[m].max()) for d, m in masks.items()}
        return out


def summary(per):
    gpu = max(t for p in per.values() for d, t in p.items() if d.startswith("G"))
    hbm = max(t for p in per.values() for d, t in p.items() if d.startswith("H"))
    return gpu, hbm


if __name__ == "__main__":
    import time
    sub = json.loads((SIM / "examples/baseline/submission.json").read_text())["placements_mm"]
    for h in (1.0, 0.5):
        m = Model(h)
        t = time.time()
        per = m.evaluate(sub)
        print(h, "s=%.2f" % (time.time() - t), summary(per))
