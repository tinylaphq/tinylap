#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 The TinyLap contributors
#
# SPDX-License-Identifier: AGPL-3.0-or-later

# Turns record-walkthrough.js's video into the README's GIF and the landing
# page's mp4 beside it: the cuts left out, 960 px wide, one palette for the
# whole GIF.
# Run by hand: apps/timing/test/layout/make-walkthrough-gif.sh <out-dir> <gif> [width] [fps]
# (a smaller one for chat apps: 640 10)
set -euo pipefail
dir=$1
gif=$2
width=${3:-960}
fps=${4:-15}
keep=$(node -e '
  const { end, cuts } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const out = cuts.map(([a, b]) => `between(t,${a},${b})`).join("+");
  process.stdout.write(`not(${out})*lt(t,${end})`);
' "$dir/cuts.json")
filters="fps=25,select='$keep',setpts=N/25/TB,fps=$fps,scale=$width:-1:flags=lanczos"
ffmpeg -v error -y -i "$dir/raw.webm" -vf "$filters,palettegen=max_colors=128:stats_mode=diff" "$dir/palette.png"
ffmpeg -v error -y -i "$dir/raw.webm" -i "$dir/palette.png" -lavfi "$filters [v]; [v][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$gif"
ffmpeg -v error -y -i "$dir/raw.webm" -vf "${filters/scale=$width:-1/scale=$width:-2}" -c:v libx264 -pix_fmt yuv420p -crf 23 -preset slow -movflags +faststart "${gif%.gif}.mp4"
ls -l "$gif" "${gif%.gif}.mp4"
