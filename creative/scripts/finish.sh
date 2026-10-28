#!/bin/sh
# Film finish for a cut (creative/CINEMATIC.md section 6): subtle halation around bright lights (warm-red glow from the
# highlights only), a soft vignette, and moving luma grain. Audio is copied untouched.
# Run inside the tools container (it has ffmpeg): sh finish.sh <in.mp4> <out.mp4> [grain=7] [halation=0.28]
set -eu
in="$1"; out="$2"; grain="${3:-7}"; hal="${4:-0.28}"
ffmpeg -loglevel error -y -i "$in" -filter_complex "\
[0:v]format=gbrp,split[base][hi];\
[hi]curves=all='0/0 0.72/0 1/1',gblur=sigma=14,colorchannelmixer=rr=1.0:gg=0.45:bb=0.25[glow];\
[base][glow]blend=all_mode=screen:all_opacity=${hal},format=yuv420p,\
vignette=angle=PI/5:mode=forward,\
noise=c0s=${grain}:c0f=t+u[v]" \
  -map "[v]" -map "0:a?" -c:v libx264 -crf 17 -preset slow -pix_fmt yuv420p -c:a copy -movflags +faststart "$out"
echo "finished: $out"
