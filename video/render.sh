#!/usr/bin/env bash
# Render the explainer video. Edit video/data.json, then run:
#   bash video/render.sh
# Writes public/media/chipletchill.mp4 (1080p), public/media/chipletchill-720.mp4, public/media/poster.png
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/media
node video/render.mjs
ffmpeg -y -loglevel error -i public/media/chipletchill.mp4 -vf scale=1280:720 -c:v libx264 -pix_fmt yuv420p -crf 28 -preset slow -movflags +faststart public/media/chipletchill-720.mp4
ffprobe -v error -show_entries format=duration,size:stream=width,height,codec_name -of compact public/media/chipletchill.mp4
ffprobe -v error -show_entries format=duration,size:stream=width,height,codec_name -of compact public/media/chipletchill-720.mp4
