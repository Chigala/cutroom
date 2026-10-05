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

# Sounds of the kinds YouTube edits use, CC0 on Freesound (Freesound's own previews).
sound() { curl -fsSL -o "$work/$1.mp3" "https://cdn.freesound.org/previews/$2"; }
sound laugh 481/481735_2524442-hq.mp3     # craigsmith, "Man Laughing Heartily"
sound airhorn 547/547020_7295304-hq.mp3   # neopolitansixth, "DJ Airhorn"
sound scratch 431/431777_817038-hq.mp3    # musicvision31, "Record Scratch #4"
sound boom 512/512389_3997858-hq.mp3      # Kievinay, "Bass Impact - Ki_01"
sound whoosh 60/60026_71257-hq.mp3        # qubodup, "Swosh swoosh whoosh"

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
  [2:a]atrim=0.7:2.3,asetpts=PTS-STARTPTS,volume=1.8,afade=t=out:st=1.35:d=0.25,adelay=2200|2200,apad,atrim=0:6,alimiter=limit=0.9[aud]" \
  -map "[v]" -map "[aud]" "${ENC[@]}" "${AUDIO[@]}" "$out/memes-with.mp4"

# Sound effects: a punch-in edit, silent, then with a whoosh, a record scratch, and an airhorn on a
# bass hit for the last, tightest punch-in.
ffmpeg -v error -y -i "$work/talk.mp4" -filter_complex "
  $(talk 1 2.7)[a];
  [0:v]trim=2.7:4.3,setpts=PTS-STARTPTS,fps=30,crop=443:554:48:0,scale=$W:$H,setsar=1[b];
  $(talk 4.3 5.7)[c];
  [0:v]trim=5.7:7,setpts=PTS-STARTPTS,fps=30,crop=386:483:77:0,scale=$W:$H,setsar=1[d];
  [a][b][c][d]concat=n=4:v=1:a=0[v]" -map "[v]" "${ENC[@]}" "$work/punch.mp4"
cp "$work/punch.mp4" "$out/sounds-without.mp4"
ffmpeg -v error -y -i "$work/punch.mp4" -i "$work/whoosh.mp3" -i "$work/scratch.mp3" -i "$work/airhorn.mp3" -i "$work/boom.mp3" \
  -filter_complex "
  [1:a]volume=1.0,adelay=1620|1620[w];
  [2:a]volume=0.45,adelay=2530|2530[s];
  [3:a]atrim=0:1.4,afade=t=out:st=1.1:d=0.3,volume=1.6,adelay=4700|4700[h];
  [4:a]volume=0.5,adelay=4650|4650[b];
  [w][s][h][b]amix=inputs=4:duration=longest:normalize=0,apad,atrim=0:6,alimiter=limit=0.9[mix]" \
  -map 0:v -map "[mix]" -c:v copy "${AUDIO[@]}" -shortest -movflags +faststart "$out/sounds-with.mp4"

cat >"$out/CREDITS.txt" <<EOF
Onboarding demo footage, from Pexels (https://www.pexels.com/license/): free to use and edit.
The people shown don't endorse Cutroom.

Talking: https://www.pexels.com/video/$TALK/ (ANTONI SHKRABA production)
Reaction: https://www.pexels.com/video/$LAUGH/ (Tima Miroshnichenko)
B-roll: https://www.pexels.com/video/$BROLL/ (Ammad Rasool)

Sounds, from Freesound, CC0 (public domain):
Laugh: "Man Laughing Heartily" by craigsmith, https://freesound.org/people/craigsmith/sounds/481735/
Airhorn: "DJ Airhorn" by neopolitansixth, https://freesound.org/people/neopolitansixth/sounds/547020/
Record scratch: "Record Scratch #4" by musicvision31, https://freesound.org/people/musicvision31/sounds/431777/
Bass hit: "Bass Impact - Ki_01" by Kievinay, https://freesound.org/people/Kievinay/sounds/512389/
Whoosh: "Swosh swoosh whoosh" by qubodup, https://freesound.org/people/qubodup/sounds/60026/
EOF
ls -la "$out"
