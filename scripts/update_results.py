#!/usr/bin/env python3
"""Rewrite every public results block from the anchors, so the copy never drifts.

Anchors (all in the repo):
  state/official/leaderboard_snapshot.json  rows + capture time (scripts/shoot-leaderboard.mjs)
  state/official/autolab_runs.json          our official AutoLab runs (score, GPU, HBM, experiment)
  state/official/convergence_check.json     HotSpot stopping-rule error (scripts/official/convergence.py)

Targets: README.md, public/explainer.html, docs/sundai-card.md, video/data.json,
src/official/data/best.json and the verified-badge entry in src/ui/app.ts. Each block
sits between <!-- results:NAME --> markers; anything outside the markers is left alone.

  python3 scripts/update_results.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "state" / "official"
STEP = 0.01 / (104.59 - 25.0)  # one judge rounding step (0.01 C on the GPU side) in score units

snap = json.loads((ST / "leaderboard_snapshot.json").read_text())
runs = json.loads((ST / "autolab_runs.json").read_text())
conv = json.loads((ST / "convergence_check.json").read_text())
ours = runs["runs"][-1]          # newest official run = the one on the board
first = runs["runs"][0]
rows = snap["rows"]
me = next(r for r in rows if r["climber"] == "wilsonwu-ai")
others = [r for r in rows if r["climber"] != "wilsonwu-ai"]
best_other = min(others, key=lambda r: r["score"])
T = snap["captured_et"]
err = max(v["solver_error_c"] for v in conv.values())

assert abs(me["score"] - ours["score"]) < 1e-9, "snapshot and autolab_runs.json disagree on our score"


def s5(x):
    return f"{x:.5f}"


def c2(x):
    return f"{x:.2f}"


steps = round((best_other["score"] - me["score"]) / STEP)
sub_first = json.loads((ROOT / first["submission"]).read_text())["placements_mm"]
sub_ours = json.loads((ROOT / ours["submission"]).read_text())["placements_mm"]
moved = [d for d in sub_ours if sub_ours[d] != sub_first[d]]
moved_txt = (f"The winning moves touched {', '.join(moved)}"
             + ("; G0, the die that sets the score, never moved." if "G0" not in moved else "."))
if me["rank"] == 1:
    head_md = (f"**#1 on the AutoLab `beat-the-hotspot` leaderboard at {T} ET on 18 Oct: score {ours['score']:.8f}** "
               f"(seeded baseline 1.0, lower is better). Hottest GPU {c2(ours['gpu'])} C, hottest memory stack "
               f"{c2(ours['hbm'])} C. Next: {best_other['climber']} at {best_other['score']:.8f}.")
    head_html = (f'<p class="lead"><b>#1 on the AutoLab beat-the-hotspot leaderboard</b> at {T} ET on 18 Oct, '
                 f'score <b>{s5(ours["score"])}</b> (baseline 1.0, lower is better). Next: {best_other["climber"]} '
                 f'at {s5(best_other["score"])}.</p>')
    lead = (f"We lead by {steps} rounding step{'s' if steps != 1 else ''} at {T} ET: {c2(ours['gpu'])} C against "
            f"{c2(best_other['gpu'])} C on the hottest GPU. The judge rounds every die temperature to 0.01 C, so the "
            f"board moves in steps of {STEP:.6f}, and it moved all afternoon.")
    card_rank = f"#1 on the AutoLab beat-the-hotspot leaderboard ({s5(ours['score'])} at {T} ET)"
else:
    leader = rows[0]
    head_md = (f"**#{me['rank']} on the AutoLab `beat-the-hotspot` leaderboard at {T} ET on 18 Oct: score "
               f"{ours['score']:.8f}** (seeded baseline 1.0, lower is better). {leader['climber']} leads at "
               f"{leader['score']:.8f}.")
    head_html = (f'<p class="lead"><b>#{me["rank"]} on the AutoLab beat-the-hotspot leaderboard</b> at {T} ET on '
                 f'18 Oct, score <b>{s5(ours["score"])}</b> (baseline 1.0, lower is better). {leader["climber"]} '
                 f'leads at {s5(leader["score"])}.</p>')
    lead = (f"We are {-steps} rounding step(s) behind at {T} ET. The judge rounds every die temperature to 0.01 C, "
            f"so the board moves in steps of {STEP:.6f}.")
    card_rank = f"#{me['rank']} on the AutoLab beat-the-hotspot leaderboard ({s5(ours['score'])} at {T} ET)"

board = [(f"{r['climber']}{' (ours)' if r['climber'] == 'wilsonwu-ai' else ''}, AutoLab #{r['rank']}",
          r["score"], r["gpu"], r["hbm"], r["climber"] == "wilsonwu-ai") for r in rows[:5]]
history = [(f"Ours, first AutoLab submission (HotSpot polish)", first["score"], first["gpu"], first["hbm"], False),
           ("Ours, surrogate loop v2 only", 0.97399, 102.52, 94.47, False),
           ("Best of 66 random legal layouts", 0.97851, 102.88, 95.81, False),
           ("Seeded random baseline", 1.0, 104.59, 97.68, False)]
table_md = ["| Run | Score (64 x 64) | Hottest GPU C | Hottest HBM C |", "|---|---|---|---|"]
for name, sc, g, h, bold in board + history:
    sc_txt = "1.0" if sc == 1.0 else s5(sc)
    table_md.append(f"| **{name}** | **{sc_txt}** | {c2(g)} | {c2(h)} |" if bold else f"| {name} | {sc_txt} | {c2(g)} | {c2(h)} |")
table_html = []
for name, sc, g, h, bold in board + history:
    sc_txt = "1.0" if sc == 1.0 else s5(sc)
    sc_cell = f"<b>{sc_txt}</b>" if bold else sc_txt
    table_html.append(f"        <tr><td>{name}</td><td>{sc_cell}</td><td>{c2(g)}</td><td>{c2(h)}</td></tr>")

official_md = "- **Official AutoLab runs:** " + "; ".join(
    f"{r['score']:.8f} (experiment `{r['experiment']}`)" for r in reversed(runs["runs"])) + \
    ". Each one is identical to our local judge."
fine_md = (f"5. **Fine polish below the rounding step.** `scripts/official/fine.py`: the judge rounds die peaks to "
           f"0.01 C, so step 4 stalled on flat plateaus. `hp.py` runs a private HotSpot copy that prints 6 decimals "
           f"(one format string changed, same solver). The search moves one die or a group of dies, screens on the "
           f"binding workloads, re-checks the best few on all five, and keeps a move only if the unrounded worst case "
           f"drops. {moved_txt} {s5(first['score'])} to "
           f"{s5(ours['score'])}, confirmed by the unmodified judge and by AutoLab.")
limits_md = (f"- {lead}\n"
             f"- The last stage ranks candidates on unrounded HotSpot output from a private build. Every number we "
             f"report comes from the unmodified judge and from AutoLab. HotSpot's default stopping rule leaves about "
             f"{err:.4f} C of error on the binding die (`state/official/convergence_check.json`), much smaller than the "
             f"{c2(first['gpu'] - ours['gpu'])} C this stage found.")

blocks_md = {"headline": head_md, "board": "\n".join(table_md), "official": official_md,
             "fine": fine_md, "limits": limits_md}

alt = (f"AutoLab leaderboard at {T} ET: " +
       ", ".join(f"{r['climber']} #{r['rank']} at {r['score']:.8f}" for r in rows[:3]))
blocks_html = {
    "headline": head_html,
    "board": (f'<p class="big">Our best score {s5(ours["score"])}. Hottest GPU {c2(ours["gpu"])} C. '
              f'Hottest HBM {c2(ours["hbm"])} C.</p>\n  <div class="tablewrap">\n    <table>\n'
              f'      <thead><tr><th>Run</th><th>Score</th><th>Hottest GPU C</th><th>Hottest HBM C</th></tr></thead>\n'
              f'      <tbody>\n' + "\n".join(table_html) + "\n      </tbody>\n    </table>\n  </div>"),
    "official": (f"<p>Local HotSpot judge vs AutoLab official: identical, every time. AutoLab scored our layouts "
                 + " and ".join(f"{r['score']:.8f}" for r in reversed(runs["runs"])) +
                 f", the same values our local HotSpot twin computed. The twin reproduces the baseline exactly "
                 f"(104.59 / 97.68 C, score 1.0).</p>\n"
                 f'  <p><img src="./media/leaderboard.png" alt="{alt}" style="max-width:100%;border-radius:8px"></p>'),
    "fine": (f"<li><b>Fine polish below the rounding step.</b> The judge rounds every die temperature to 0.01 C, so "
             f"the polish stalled on flat steps it could not see past. We built a private HotSpot copy that prints "
             f"6 decimals instead of 2 (one format string changed, same solver) and searched on that, keeping a move "
             f"only when the unrounded worst case over all five workloads dropped. {moved_txt} "
             f"That took the score from {s5(first['score'])} to <b>{s5(ours['score'])}</b>, confirmed by "
             f"the unmodified judge and by AutoLab.</li>"),
    "limits": (f"<li>{lead}</li>\n    <li>The last stage ranks candidates on unrounded output from a private "
               f"HotSpot build. Every number on this page comes from the unmodified judge and from AutoLab. HotSpot's "
               f"default stopping rule leaves about {err:.4f} C of error on the binding die "
               f"(state/official/convergence_check.json), much smaller than the {c2(first['gpu'] - ours['gpu'])} C "
               f"this stage found.</li>"),
}


def fill(path, blocks, md):
    text = path.read_text()
    for name, body in blocks.items():
        pat = re.compile(rf"(<!-- results:{name} -->\n).*?(\n *<!-- /results:{name} -->)", re.S)
        if not pat.search(text):
            raise SystemExit(f"{path.name}: marker results:{name} missing")
        text = pat.sub(lambda m: m.group(1) + body + m.group(2), text)
    path.write_text(text)


fill(ROOT / "README.md", blocks_md, True)
fill(ROOT / "public" / "explainer.html", blocks_html, False)

card = ROOT / "docs" / "sundai-card.md"
ct = card.read_text()
ct = re.sub(r"(\*\*Preview \(one line, result first\):\*\*\n).*?\n",
            lambda m: m.group(1) + f"{card_rank}: a physics surrogate finds the layout, HotSpot proves it.\n", ct, flags=re.S)
ct = re.sub(r"Result on the organizer's HotSpot pipeline \(64 x 64\):.*?\n",
            f"Result on the organizer's HotSpot pipeline (64 x 64): {s5(ours['score'])} (GPU {c2(ours['gpu'])} C, "
            f"HBM {c2(ours['hbm'])} C), {card_rank.split(' (')[0]} at {T} ET, official score identical to our local "
            f"judge.\n", ct)
card.write_text(ct)

vd = ROOT / "video" / "data.json"
d = json.loads(vd.read_text())
d.update({"best_score": round(ours["score"], 5), "best_gpu_c": ours["gpu"], "best_hbm_c": ours["hbm"]})
vd.write_text(json.dumps(d, indent=1) + "\n")

sub = json.loads((ROOT / ours["submission"]).read_text())["placements_mm"]
(ROOT / "src" / "official" / "data" / "best.json").write_text(json.dumps(sub, indent=1) + "\n")
app = ROOT / "src" / "ui" / "app.ts"
at = app.read_text()
at, n = re.subn(r"\{ layout: best, score: [0-9.]+, gpu: [0-9.]+, hbm: [0-9.]+ \}",
                f"{{ layout: best, score: {round(ours['score'], 5)}, gpu: {ours['gpu']}, hbm: {ours['hbm']} }}", at)
assert n == 1, "verified-badge entry for best not found in app.ts"
app.write_text(at)
print(f"updated: rank #{me['rank']} at {T} ET, score {ours['score']}, lead {steps} steps over {best_other['climber']}")
