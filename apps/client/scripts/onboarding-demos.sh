#!/usr/bin/env bash
# The "without / with" demo videos on onboarding's power-ups screen, into public/onboarding/: the same
# six seconds of a creator talking, plain, then with what each power-up adds (B-roll, a reaction meme,
# sound effects). Footage from Pexels (free to use and edit), sounds from Freesound under CC0 (public
# domain); credits in CREDITS.txt. Needs ffmpeg, node, and PEXELS_API_KEY (or a .env at the repo root).
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

# Pexels video ids: the creator talking, the reaction, the B-roll.
TALK=8136210
LAUGH=4994316
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

# The sounds, picked by ear: CC0 on Freesound (Freesound's own previews).
sound() { curl -fsSL -o "$work/$1.mp3" "https://cdn.freesound.org/previews/$2"; }
sound laugh 17/17121_57789-hq.mp3     # cognito perceptum, "small audience laughter"
sound whoosh 179/179780_985466-hq.mp3 # Sclolex, "wipe1"
sound pop 437/437122_5435812-hq.mp3   # 4udiopony, "Pop Sound"
sound hit 81/81148_704648-hq.mp3      # uzerx, "SUB OCEANO D"

# 4:5 at 540x676 (even sizes, for H.264), 30 fps; the frame starts just above his head.
W=540
H=676
FRAME="fps=30,crop=$W:$H:0:16,setsar=1"
ENC=(-c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart)
AUDIO=(-c:a aac -b:a 128k)
IMPACT=/System/Library/Fonts/Supplemental/Impact.ttf
[ -f "$IMPACT" ] || IMPACT="$(fc-match -f '%{file}' 'Impact:bold' 2>/dev/null || true)"

talk() { echo "[0:v]trim=$1:$2,setpts=PTS-STARTPTS,$FRAME"; }

# Without: six seconds of him talking (the same for stock footage and memes).
ffmpeg -v error -y -i "$work/talk.mp4" -filter_complex "$(talk 1 7)[v]" -map "[v]" "${ENC[@]}" "$out/stock-without.mp4"
cp "$out/stock-without.mp4" "$out/memes-without.mp4"

# Stock footage: a cutaway to the latte art for two seconds (slowly pushing in), then back to him.
ffmpeg -v error -y -i "$work/talk.mp4" -i "$work/broll.mp4" -filter_complex "
  $(talk 1 3)[a];
  [1:v]trim=3:5,setpts=PTS-STARTPTS,fps=30,crop=$W:$H:0:'(ih-$H)/2',
    zoompan=z='1.03+0.06*on/60':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x$H:fps=30,setsar=1[b];
  $(talk 5 7)[c];
  [a][b][c]concat=n=3:v=1:a=0[v]" -map "[v]" "${ENC[@]}" "$out/stock-with.mp4"

# Memes: the line lands, a hard cut to someone losing it (pushing in on him, with the laugh and the
# caption), then back to the creator. The way a meme cut plays in a real edit.
ffmpeg -v error -y -i "$work/talk.mp4" -i "$work/laugh.mp4" -i "$work/laugh.mp3" -filter_complex "
  $(talk 1 3.2)[a];
  [1:v]trim=1.8:3.4,setpts=PTS-STARTPTS,fps=30,crop=$W:$H:0:40,
    zoompan=z='1+0.12*on/48':x='iw/2-iw/zoom/2':y='ih*0.3-ih/zoom*0.3':d=1:s=${W}x$H:fps=30,
    drawtext=fontfile='$IMPACT':text='LMAO':fontsize=86:fontcolor=white:borderw=5:bordercolor=black:x=(w-tw)/2:y=h*0.72,setsar=1[b];
  $(talk 4.8 7)[c];
  [a][b][c]concat=n=3:v=1:a=0[v];
  [2:a]atrim=0:2.1,asetpts=PTS-STARTPTS,volume=0.8,afade=t=out:st=1.6:d=0.5,adelay=2200|2200,apad,atrim=0:6,alimiter=limit=0.9[aud]" \
  -map "[v]" -map "[aud]" "${ENC[@]}" "${AUDIO[@]}" "$out/memes-with.mp4"

# Sound effects: a punch-in edit, silent, then with a whoosh into the first punch-in, a pop on the way
# back out, and a deep hit under the last, tightest one. Each timed so its peak lands on the cut.
ffmpeg -v error -y -i "$work/talk.mp4" -filter_complex "
  $(talk 1 2.7)[a];
  [0:v]trim=2.7:4.3,setpts=PTS-STARTPTS,fps=30,crop=443:554:48:0,scale=$W:$H,setsar=1[b];
  $(talk 4.3 5.7)[c];
  [0:v]trim=5.7:7,setpts=PTS-STARTPTS,fps=30,crop=386:483:77:0,scale=$W:$H,setsar=1[d];
  [a][b][c][d]concat=n=4:v=1:a=0[v]" -map "[v]" "${ENC[@]}" "$work/punch.mp4"
cp "$work/punch.mp4" "$out/sounds-without.mp4"
ffmpeg -v error -y -i "$work/punch.mp4" -i "$work/whoosh.mp3" -i "$work/pop.mp3" -i "$work/hit.mp3" \
  -filter_complex "
  [1:a]volume=0.6,adelay=1330|1330[w];
  [2:a]volume=1.0,adelay=2990|2990[p];
  [3:a]volume=0.6,afade=t=out:st=1.2:d=0.6,adelay=4670|4670[h];
  [w][p][h]amix=inputs=3:duration=longest:normalize=0,apad,atrim=0:6,alimiter=limit=0.9[mix]" \
  -map 0:v -map "[mix]" -c:v copy "${AUDIO[@]}" -shortest -movflags +faststart "$out/sounds-with.mp4"

cat >"$out/CREDITS.txt" <<EOF
Onboarding demo footage, from Pexels (https://www.pexels.com/license/): free to use and edit.
The people shown don't endorse Cutroom.

Talking: https://www.pexels.com/video/$TALK/ (ANTONI SHKRABA production)
Reaction: https://www.pexels.com/video/$LAUGH/ (Tima Miroshnichenko)
B-roll: https://www.pexels.com/video/$BROLL/ (Ammad Rasool)

Sounds, from Freesound, CC0 (public domain):
Laughter: "small audience laughter" by cognito perceptum, https://freesound.org/people/cognito%20perceptu/sounds/17121/
Whoosh: "wipe1" by Sclolex, https://freesound.org/people/Sclolex/sounds/179780/
Pop: "Pop Sound" by 4udiopony, https://freesound.org/people/4udiopony/sounds/437122/
Hit: "SUB OCEANO D" by uzerx, https://freesound.org/people/uzerx/sounds/81148/
EOF
ls -la "$out"
