#!/usr/bin/env bash
# The "without / with" demo videos on onboarding's power-ups screen, into public/onboarding/: the same
# six seconds of a creator talking, plain, then with what each power-up adds (B-roll, a reaction clip,
# sound effects). Footage from Pexels (free to use and edit; credits in CREDITS.txt), sound effects from
# Cutroom's own synthesizer. Needs ffmpeg and PEXELS_API_KEY (or a .env at the repo root).
#
#   apps/client/scripts/onboarding-demos.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
out="$here/../public/onboarding"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"
[ -z "${PEXELS_API_KEY:-}" ] && [ -f "$root/.env" ] && set -a && . "$root/.env" && set +a
: "${PEXELS_API_KEY:?PEXELS_API_KEY is needed to download the footage}"

# Pexels video ids: the talking head, the reaction, the B-roll.
TALK=36931662
LAUGH=9032413
BROLL=28889095

fetch() {
  local id="$1" dest="$2"
  local url
  url="$(curl -fsSL -H "Authorization: $PEXELS_API_KEY" "https://api.pexels.com/videos/videos/$id" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);const f=v.video_files.filter(f=>f.width>=540).sort((a,b)=>a.width-b.width)[0];console.log(f.link)})')"
  curl -fsSL -o "$dest" "$url"
}
fetch "$TALK" "$work/talk.mp4"
fetch "$LAUGH" "$work/laugh.mp4"
fetch "$BROLL" "$work/broll.mp4"

# Cutroom's own sound effects (synthesized: nothing to license).
cat >"$work/sfx.mts" <<EOF
import { sfxFile } from "$root/packages/media/src/sfx.ts";
for (const n of ["whoosh", "pop", "boom"] as const) await sfxFile(n, "$work");
EOF
"$root/apps/desktop/node_modules/.bin/jiti" "$work/sfx.mts"
sfx="$work/sfx-v3"

# 4:5 at 540x676 (even sizes, for H.264), 30 fps; the frame starts just above her head.
W=540
H=676
FRAME="fps=30,crop=$W:$H:0:30,setsar=1"
ENC=(-c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart)
IMPACT=/System/Library/Fonts/Supplemental/Impact.ttf
[ -f "$IMPACT" ] || IMPACT="$(fc-match -f '%{file}' 'Impact:bold' 2>/dev/null || true)"

talk() { echo "[0:v]trim=$1:$2,setpts=PTS-STARTPTS,$FRAME"; }

# Without: six seconds of her talking (the same for stock footage and memes).
ffmpeg -v error -y -i "$work/talk.mp4" -filter_complex "$(talk 0.3 6.3)[v]" -map "[v]" "${ENC[@]}" "$out/stock-without.mp4"
cp "$out/stock-without.mp4" "$out/memes-without.mp4"

# Stock footage: a cutaway to the latte art for two seconds (slowly pushing in), then back to her.
ffmpeg -v error -y -i "$work/talk.mp4" -i "$work/broll.mp4" -filter_complex "
  $(talk 0.3 2.3)[a];
  [1:v]trim=3:5,setpts=PTS-STARTPTS,fps=30,crop=$W:$H:0:'(ih-$H)/2',
    zoompan=z='1.03+0.06*on/60':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x$H:fps=30,setsar=1[b];
  $(talk 4.3 6.3)[c];
  [a][b][c]concat=n=3:v=1:a=0[v]" -map "[v]" "${ENC[@]}" "$out/stock-with.mp4"

# Memes: the reaction slides up in a rounded frame at the beat, with a meme caption, then leaves.
ffmpeg -v error -y -i "$work/talk.mp4" -i "$work/laugh.mp4" -filter_complex "
  $(talk 0.3 6.3)[base];
  [1:v]trim=1:3.8,setpts=PTS-STARTPTS,fps=30,crop=540:676:0:90,scale=230:288,
    drawtext=fontfile='$IMPACT':text='LMAO':fontsize=46:fontcolor=white:borderw=3:bordercolor=black:x=(w-tw)/2:y=14,
    format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*lte(hypot(max(0,abs(X-W/2)-(W/2-22)),max(0,abs(Y-H/2)-(H/2-22))),22)',
    fade=t=in:st=0:d=0.22:alpha=1,fade=t=out:st=2.6:d=0.2:alpha=1,setpts=PTS+2/TB[pip];
  [base][pip]overlay=x=28:y='H-h-36+40*pow(max(0,1-(t-2)/0.3),3)':eof_action=pass[v]" \
  -map "[v]" "${ENC[@]}" "$out/memes-with.mp4"

# Sound effects: the same punch-in edit, silent, then with a whoosh, a pop and a boom on the cuts.
ffmpeg -v error -y -i "$work/talk.mp4" -filter_complex "
  $(talk 0.3 2.0)[a];
  [0:v]trim=2.0:3.6,setpts=PTS-STARTPTS,fps=30,crop=443:554:49:40,scale=$W:$H,setsar=1[b];
  $(talk 3.6 5.0)[c];
  [0:v]trim=5.0:6.3,setpts=PTS-STARTPTS,fps=30,crop=400:500:70:50,scale=$W:$H,setsar=1[d];
  [a][b][c][d]concat=n=4:v=1:a=0[v]" -map "[v]" "${ENC[@]}" "$work/punch.mp4"
cp "$work/punch.mp4" "$out/sounds-without.mp4"
ffmpeg -v error -y -i "$work/punch.mp4" -i "$sfx/whoosh.wav" -i "$sfx/pop.wav" -i "$sfx/boom.wav" -filter_complex "
  [1:a]volume=0.8,adelay=1350|1350[w];
  [2:a]volume=0.6,adelay=3300|3300[p];
  [3:a]volume=0.6,adelay=4700|4700[b];
  [w][p][b]amix=inputs=3:duration=longest:normalize=0,apad,atrim=0:6[mix]" \
  -map 0:v -map "[mix]" -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "$out/sounds-with.mp4"

cat >"$out/CREDITS.txt" <<EOF
Onboarding demo footage, from Pexels (https://www.pexels.com/license/): free to use and edit.
The people shown don't endorse Cutroom.

Talking: https://www.pexels.com/video/$TALK/
Reaction: https://www.pexels.com/video/$LAUGH/ (Alena Darmel)
B-roll: https://www.pexels.com/video/$BROLL/ (Ammad Rasool)

Sound effects: synthesized by Cutroom (packages/media/src/sfx.ts).
EOF
ls -la "$out"
