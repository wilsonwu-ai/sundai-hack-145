#!/usr/bin/env python3
"""Rewrite every public results block from the anchors, so the copy never drifts.

Anchors (all in the repo):
  state/official/leaderboard_snapshot.json  rows + capture time (scripts/shoot-leaderboard.mjs)
  state/official/autolab_runs.json          our official AutoLab runs (score, GPU, HBM, experiment)
  state/official/convergence_check.json     HotSpot stopping-rule error (scripts/official/convergence.py)
  state/official/samples.jsonl              local-judge rows (surrogate loop v2, random layouts)
  state/official/final128_summary.json      128 x 128 finalist-mesh scores, layout-free

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
pub = [r for r in runs["runs"] if r.get("public", True)][-1]   # newest run whose layout is public
rows = snap["rows"]
me = next(r for r in rows if r["climber"] == "wilsonwu-ai")
others = [r for r in rows if r["climber"] != "wilsonwu-ai"]
best_other = min(others, key=lambda r: r["score"])
T = snap["captured_et"]
err = max(v["solver_error_c"] for v in conv.values())
NUM = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight"}
samples = [json.loads(l) for l in (ST / "samples.jsonl").read_text().splitlines() if l.strip()]
rand = [s for s in samples if s.get("source") == "random_s145" and s["passed"]]
best_rand = min(rand, key=lambda s: s["score"])
best_v2 = min((s for s in samples if str(s.get("source", "")).startswith("loop2") and s["passed"]),
              key=lambda s: s["score"])
mesh = json.loads((ST / "final128_summary.json").read_text())["rows"]
hist = [json.loads(l) for l in (ST / "board_history.jsonl").read_text().splitlines() if l.strip()]
held1 = [h["captured_et"] for h in hist if any(r["climber"] == "wilsonwu-ai" and r["rank"] == 1 for r in h["rows"])]
held1_txt = f" We held #1 from {held1[0]} ET to at least {held1[-1]} ET." if held1 else ""

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
            f"board moves in steps of {STEP:.6f}.")
    card_rank = f"#1 on the AutoLab beat-the-hotspot leaderboard ({s5(ours['score'])} at {T} ET)"
else:
    leader = rows[0]
    head_md = (f"**#{me['rank']} on the AutoLab `beat-the-hotspot` leaderboard at {T} ET on 18 Oct: score "
               f"{ours['score']:.8f}** (seeded baseline 1.0, lower is better). {leader['climber']} leads at "
               f"{leader['score']:.8f}.{held1_txt}")
    head_html = (f'<p class="lead"><b>#{me["rank"]} on the AutoLab beat-the-hotspot leaderboard</b> at {T} ET on '
                 f'18 Oct, score <b>{s5(ours["score"])}</b> (baseline 1.0, lower is better). {leader["climber"]} '
                 f'leads at {s5(leader["score"])}.{held1_txt}</p>')
    lead = (f"We are {-steps} rounding steps behind {best_other['climber']} at {T} ET ({c2(ours['gpu'])} C against "
            f"{c2(best_other['gpu'])} C on the hottest GPU).{held1_txt} The judge rounds every die temperature to 0.01 C, "
            f"so the board moves in steps of {STEP:.6f}.")
    card_rank = f"#{me['rank']} on the AutoLab beat-the-hotspot leaderboard ({s5(ours['score'])} at {T} ET)"

board = [(f"{r['climber']}{' (ours)' if r['climber'] == 'wilsonwu-ai' else ''}, AutoLab #{r['rank']}",
          r["score"], r["gpu"], r["hbm"], r["climber"] == "wilsonwu-ai") for r in rows[:5]]
history = [(f"Ours, first AutoLab submission (HotSpot polish)", first["score"], first["gpu"], first["hbm"], False),
           ("Ours, surrogate loop v2 only", best_v2["score"], best_v2["worst_gpu_c"], best_v2["worst_hbm_c"], False),
           (f"Best of {len(rand)} random legal layouts", best_rand["score"], best_rand["worst_gpu_c"],
            best_rand["worst_hbm_c"], False),
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
held = [r for r in runs["runs"] if not r.get("public", True)]
def held_txt(code):
    return (f"The exact layouts behind {', '.join(s5(r['score']) for r in held)} are held back until the hack ends, "
            f"so nobody starts from them mid-race. The app and {code('src/official/data/best.json')} carry our best "
            f"public layout ({s5(pub['score'])}); the held layouts are small moves from it, so some die positions "
            f"match. Every score above is official either way.")


md_code = lambda s: f"`{s}`"
html_code = lambda s: f'<span class="mono">{s}</span>'
conv_txt = (f"HotSpot's default stopping rule leaves about {err:.4f} C of error on G0, the binding die, measured on "
            f"{NUM.get(len(conv), len(conv))} layouts from this stage")
earlier = next(m for m in mesh if m["key"] == "earlier")
top128 = next((m for m in mesh if m["key"] == "ours"), None)
mesh_lead = ("128 x 128 finalist check (the hill's --final mesh, scored against its own 128 x 128 reference, so "
             "never compared with the 64 x 64 numbers above): ")
mesh_rows = "; ".join(f"{s5(m['score128'])} for {m['label']} ({s5(m['score64'])} at 64 x 64, GPU {c2(m['gpu'])} C, "
                      f"HBM {c2(m['hbm'])} C)" for m in ([top128] if top128 else []) + [earlier])
if top128:
    d = earlier["score128"] - top128["score128"]
    mesh_end = (f". On the finer mesh the polished layout beats the earlier one by {d:.5f}, so the polish is not a "
                f"64 x 64 artefact." if d > 0 else
                f". On the finer mesh the polished layout does not beat the earlier one, so part of the 64 x 64 gain does "
                f"not carry over.")
else:
    mesh_end = ". We have not yet run our best layout at 128 x 128."
mesh_txt = mesh_lead + mesh_rows + mesh_end
limits_md = (f"- {lead}\n" + (f"- {held_txt(md_code)}\n" if held else "") +
             f"- The last stage ranks candidates on unrounded HotSpot output from a private build. Every number we "
             f"report comes from the unmodified judge and from AutoLab. {conv_txt} "
             f"(`state/official/convergence_check.json`), much smaller than the "
             f"{c2(first['gpu'] - ours['gpu'])} C this stage found.")

blocks_md = {"headline": head_md, "board": "\n".join(table_md), "official": official_md,
             "fine": fine_md, "limits": limits_md, "mesh128": f"- **{mesh_txt.split(' (', 1)[0]}** (" + mesh_txt.split(' (', 1)[1]}

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
    "limits": (f"<li>{lead}</li>\n" + (f"    <li>{held_txt(html_code)}</li>\n" if held else "") + f"    <li>The last stage ranks candidates on unrounded output from a private "
               f"HotSpot build. Every number on this page comes from the unmodified judge and from AutoLab. "
               f"{conv_txt} ({html_code('state/official/convergence_check.json')}), much smaller than the "
               f"{c2(first['gpu'] - ours['gpu'])} C this stage found.</li>"),
    "mesh128": f"<li>{mesh_txt}</li>",
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
ct, n = re.subn(r"finds the last [0-9.]+ C on the hottest GPU \([0-9.]+ C to [0-9.]+ C\)",
                f"finds the last {c2(first['gpu'] - ours['gpu'])} C on the hottest GPU ({c2(first['gpu'])} C to "
                f"{c2(ours['gpu'])} C)", ct)
assert n == 1, "card fine-pass sentence not found"
card.write_text(ct)

vd = ROOT / "video" / "data.json"
d = json.loads(vd.read_text())
d.update({"best_score": round(ours["score"], 5), "best_gpu_c": ours["gpu"], "best_hbm_c": ours["hbm"]})
vd.write_text(json.dumps(d, indent=1) + "\n")

sub = json.loads((ROOT / pub["submission"]).read_text())["placements_mm"]
(ROOT / "src" / "official" / "data" / "best.json").write_text(json.dumps(sub, indent=1) + "\n")
app = ROOT / "src" / "ui" / "app.ts"
at = app.read_text()
at, n = re.subn(r"\{ layout: best, score: [0-9.]+, gpu: [0-9.]+, hbm: [0-9.]+ \}",
                f"{{ layout: best, score: {round(pub['score'], 5)}, gpu: {pub['gpu']}, hbm: {pub['hbm']} }}", at)
assert n == 1, "verified-badge entry for best not found in app.ts"
app.write_text(at)
print(f"updated: rank #{me['rank']} at {T} ET, score {ours['score']}, lead {steps} steps over {best_other['climber']}")
