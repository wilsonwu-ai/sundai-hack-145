"""Compare low-fi peaks with HotSpot peaks on judged samples."""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lowfi as L
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows = [r for r in rows if r.get("passed")]
m = L.Model(float(sys.argv[2]) if len(sys.argv) > 2 else 1.0)
hs, lf, cl, lid = [], [], [], []
for k, r in enumerate(rows):
    per = m.evaluate(r["placements_mm"])
    for wl, p in per.items():
        for d, t in p.items():
            hs.append(r["per_workload"][wl][d]); lf.append(t); cl.append(d[0]); lid.append(k)
hs, lf = np.array(hs), np.array(lf)
A = np.c_[lf, np.ones_like(lf)]
c, *_ = np.linalg.lstsq(A, hs, rcond=None)
res = hs - A @ c
print(f"n={len(rows)} layouts, {len(hs)} die-peaks; fit hs = {c[0]:.3f}*lf + {c[1]:.2f}; "
      f"r={np.corrcoef(hs, lf)[0,1]:.4f} rmse={res.std():.2f}C")
cl, lid = np.array(cl), np.array(lid)
fits = {}
for c0 in "GH":
    k = cl == c0
    A = np.c_[lf[k], np.ones(k.sum())]
    cc, *_ = np.linalg.lstsq(A, hs[k], rcond=None)
    fits[c0] = cc
    print(c0, f"fit {cc[0]:.3f}*lf+{cc[1]:.2f} rmse={(hs[k]-A@cc).std():.2f}")
amb = 25.0
pred, true = [], []
for k, r in enumerate(rows):
    sel = lid == k
    g = max(fits["G"][0]*lf[sel & (cl=="G")] + fits["G"][1]); h = max(fits["H"][0]*lf[sel & (cl=="H")] + fits["H"][1])
    pred.append(max((g-amb)/(104.59-amb), (h-amb)/(97.68-amb))); true.append(r["score"])
pred, true = np.array(pred), np.array(true)
from scipy.stats import spearmanr
print("score: spearman", round(spearmanr(pred, true).correlation, 3), "mae", round(abs(pred-true).mean(), 4),
      "best true", true.min().round(4), "true of best pred", true[pred.argmin()].round(4))
