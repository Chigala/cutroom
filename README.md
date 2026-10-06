# Cutroom

An AI-native video editor.

You direct, the agent edits. Drop raw footage in, and the app understands it (every word said, pauses,
shots, beats). The agent makes the first cut on its own, and you change anything by saying what you
want, pointing at the video, or editing the words. Every change shows up as a chip you can keep or undo,
and the project is a real folder of plain files you can open in any editor.

## Getting started

You need **Node 22.12+**, **Git**, and **pnpm** (the repo pins its version: `corepack enable` sets it up).

```bash
git clone <this repo> && cd ai-native-videoeditor
corepack enable
pnpm install
cp .env.example .env   # optional: development settings (API keys go in the app, not here)
pnpm dev               # the desktop app (Electron), with hot reload for the UI
```

Other commands:

```bash
pnpm dev:web        # the UI alone in a browser, on an in-memory demo project
pnpm check          # lint + typecheck + tests
pnpm build          # production build (includes the export renderer bundle)
pnpm dist           # package the app for this platform with electron-builder
```

Speech recognition (whisper.cpp and its model, about 1.6 GB) installs itself on the first import.

### macOS

```bash
brew install ffmpeg
```

To package the app with its own ffmpeg, whisper and audio tools (so users install nothing), run
`pnpm --filter @vedit/desktop tools` once (needs Xcode's command line tools and cmake).

## Installers

`pnpm dist` builds the installer for the system you're on: a .dmg on macOS, an .exe installer on
Windows, an AppImage and a .deb on Linux. First run `pnpm --filter @vedit/desktop tools` on that same
system: it downloads ffmpeg and the voice cleaner (version-pinned and checksum-verified) and compiles
whisper.cpp. That needs cmake and a C++ compiler: Xcode's command line tools on macOS, Visual Studio's
"Desktop development with C++" on Windows, `build-essential` on Linux.

On GitHub, the **Build installers** workflow (`.github/workflows/build.yml`) builds all three on
their own systems, from the Actions tab or when a `v*` tag is pushed, and attaches them to the run.
They aren't signed yet, so macOS asks for "Open Anyway" (System Settings → Privacy & Security) and
Windows shows a SmartScreen warning ("More info" → "Run anyway").

### Windows

```powershell
winget install Git.Git OpenJS.NodeJS.LTS Gyan.FFmpeg
```

Open a new terminal afterwards so `ffmpeg` is on your PATH, then follow Getting started.

### Linux (Ubuntu/Debian)

```bash
sudo apt install ffmpeg git build-essential cmake \
  libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxshmfence1 libdrm2
```

On Ubuntu 24.04+ the sound library is `libasound2t64`. whisper.cpp is compiled on the first import
(that's what `build-essential` and `cmake` are for). `pnpm dev` runs Electron without Chromium's
sandbox helper when it isn't set up as root (it never is in a fresh `node_modules`), and says so.

### WSL (Windows Subsystem for Linux)

Works on Windows 11 with WSL 2, whose WSLg shows Linux windows on your desktop. Install as for Linux,
inside the distro, and:

- **Keep the repo and your projects in the Linux file system** (`~/...`), not under `/mnt/c`. Files on
  the Windows drive are slow from Linux and never report changes, so edits made outside the app and
  library drops aren't seen.
- Exports render in software (no GPU video encoding in WSL): they work, just slower than native.
- For everyday editing, the native Windows app is the better choice. WSL suits development.

### What works where

| | macOS | Windows | Linux / WSL |
|---|---|---|---|
| Editing, agent, captions, graphics, music, export | yes | yes* | yes* |
| Whisper transcription | GPU (Metal) | downloads on first import* | built on first import (CPU) |
| Voice cleanup (DeepFilterNet) | yes | yes* | yes* |
| Face framing, tracking, sound recognition | yes | yes* | yes* |
| Cutouts (text behind the person, background changes) | yes | yes* | yes* |
| Packaged installer with bundled tools | yes | yes* | yes* |

On macOS, faces, people, sounds and cutouts use Apple's frameworks. On Windows and Linux, open models
do the same jobs on ONNX Runtime (on the graphics card through DirectML on Windows, on the CPU
elsewhere). Each downloads once, the first time it's needed, checked against a pinned hash:

| Job | Model | Download | Licence |
|---|---|---|---|
| Faces | YuNet (OpenCV) | 0.2 MB | MIT |
| People | YOLOX-Nano (Megvii) | 3.5 MB | Apache-2.0 |
| Sounds | PANNs CNN14 (labels: Google's AudioSet) | 330 MB | MIT (labels CC BY 4.0) |
| Cutouts | Robust Video Matting | 15 MB | GPL-3.0 |

`VEDIT_VISION=onnx` makes a Mac use them too, to compare the two.

\* Windows and Linux support is new and still being tested: expect rough edges, and please report them.

## Claude

The agent runs on your own Claude plan (Pro or Max) through Claude Code: install it and sign in, and
there's no key to set. The app can install and update it from Settings → Claude, or:

- macOS, Linux, WSL: `curl -fsSL https://claude.ai/install.sh | bash`, then `claude` to sign in
- Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`, then `claude` to sign in

Settings → Claude also picks the model and how hard it thinks. (An API-key backend exists in
`packages/agent/src/api.ts` but is switched off for now.)

API keys for stock footage, memes, sound effects and Groq transcription are each person's own, entered
in onboarding or Settings → Media sources and stored encrypted on the computer; they're never read from
the environment.

## What it does

- **Indexing** (on import, in the background): a 540p preview proxy (hardware encoded), audio
  measured (silences, loudness, waveform), every word transcribed locally with whisper.cpp and snapped
  to the measured silences, shot changes detected, and for music a beat map.
- **First cut**: drop clips into an empty project and the agent makes a draft as soon as indexing is
  done: retakes and dead air cut, best takes kept, hook title, caption emphasis, zooms.
- **Inspirations**: editing styles to follow ("Edit it like…"): punchy explainer, podcast clip,
  storytime, tutorial, news commentary, creator product ad, hype montage, calm vlog. Each is a brief the
  agent edits to (structure, pacing, captions, motion, sound, look) plus the settings that make it
  concrete; every card previews your own footage in that style. Learn a new one from a video you love:
  the agent measures its rhythm, studies its frames and writes the brief into your library
  (`Cutroom Library/Inspirations/`). A brand kit is who you are; an inspiration is how this video is cut.
- **Chat**: ask for changes. The agent reads transcripts, looks at frames of the footage, cuts by word
  ranges, fixes misheard words, finds music, and runs the checks before it hands work back.
- **Words tab**: edit the video by editing its text. Select words and press Delete to cut them, E to
  emphasize them in captions, double-click to fix a misheard word.
- **Point**: click the video to pin a comment ("zoom here when he laughs") or to aim an instruction.
  Send all open comments to the agent at once.
- **Timeline**: trim shots by their edges, S to split at the playhead, drag zooms, titles and captions.
- **Checks**: hook timing, safe zones, beat sync, captions, dead air, shot lengths, ducking. Most have
  a one-click fix.
- **Versions**: "make 3 versions" runs the agent three ways in parallel; watch them side by side, use
  one, or take the cut from one and the music from another. History restores any earlier point.
- **Export**: Remotion renders the same composition the preview plays, from full-quality masters; the
  voice is cut separately with ffmpeg, cleaned and levelled to -14 LUFS, then mixed under the picture.

## The project folder

The video is a pure function of the folder. Everything the agent and the UI do is an op on these files,
recorded in `.history/log.jsonl`, so undo, history, versions and "what did the AI change" all come from
one mechanism. Edit any file by hand and the change appears in the app as an undoable commit.

```
My Video/
  project.json              name, format
  STYLE.md                  your taste in plain words; the agent follows it
  inspirations/<id>.md      the editing style this video follows: its brief and settings
  look.json                 color grade
  sources/index.json        imported clips (paths, not copies)
  sources/transcripts.json  every word said, with timings
  sources/analysis.json     silences, shot changes, beats
  timeline/scenes.json      the cut, in playback order
  captions/captions.json    caption style, word fixes and emphasis, manual captions
  motion/zooms.json         punch-ins
  overlays/titles.json      hook and titles
  audio/music.json          music track, volume, ducking
  audio/sfx.json            sound effects (synthesized, nothing to license)
  comments/comments.json    notes pinned to moments
  versions/                 saved alternatives
  exports/                  rendered videos
  .history/                 commit log and chat
  .cache/                   proxies, waveforms, masters (safe to delete)
```

## Code

```
apps/desktop        Electron main (project service, indexer, exporter, versions) and preload
apps/client         React UI (Remotion Player preview, chat, timeline, words, versions)
packages/project    schemas, ops, commits, speech/caption maths, folder store
packages/checks     quality checks with fixes
packages/composition the Remotion composition: video = render(doc)
packages/media      ffmpeg, whisper.cpp, beat tracking, proxies, voice mastering, music search
packages/agent      tools + two backends (Claude API, Claude Agent SDK)
packages/render     export: masters, Remotion render, voice track, mix
packages/bridge     the typed contract between UI and host
```

The UI only talks to `EditorApi` (`packages/bridge`). Today Electron's main process implements it on
real folders; a cloud service could implement the same contract for web and mobile.
