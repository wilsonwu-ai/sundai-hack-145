#!/usr/bin/env bash
# One-time setup for the official Track 2 judge on macOS.
# 1. Builds HotSpot from the organizer's bundled C source (no SuperLU, plain -lm).
# 2. Runs the organizer's unit tests and verifier on their baseline.
# 3. Scores the seeded baseline locally at 64x64. It must reproduce reference_64.json
#    (104.59 / 97.68 C, score 1.0) before any other number is trusted.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SIM="$REPO/.official/sim"
BUILD="$REPO/.official/hsbuild"
OUT="$REPO/state/official"
mkdir -p "$OUT"

if [ ! -x "$BUILD/hotspot" ]; then
  rm -rf "$BUILD"
  cp -R "$SIM/vendor/HotSpot" "$BUILD"
  (cd "$BUILD" && rm -f hotspot hotfloorplan libhotspot.a ./*.o && make SUPERLU=0 hotspot >"$OUT/build.log" 2>&1) \
    || { echo "BUILD FAILED, tail of log:"; tail -20 "$OUT/build.log"; exit 1; }
fi
file "$BUILD/hotspot"

echo "== organizer unit tests"
(cd "$SIM" && python3 -m unittest discover -s tests 2>&1 | tail -3)

echo "== organizer verifier on baseline"
(cd "$SIM" && python3 verify_submission.py examples/baseline/submission.json --output "$OUT/baseline_feasibility.json" >/dev/null; \
  python3 -c "import json;print('passed:', json.load(open('$OUT/baseline_feasibility.json'))['passed'])")

echo "== local judge, baseline, 64x64"
rm -f "$OUT/calibration.jsonl"
python3 "$HERE/local_judge.py" "$SIM/examples/baseline/submission.json" --grid 64 --out "$OUT/calibration.jsonl"
echo "expected: score 1.0, gpu 104.59, hbm 97.68"
