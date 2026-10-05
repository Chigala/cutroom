# AI-native video editor

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
cp .env.example .env   # optional: API keys for stock footage, memes and sounds
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
| Face framing, tracking, sound recognition, voice cleanup | yes | not yet | not yet |
| Cutouts (text behind the person, background changes) | yes | not yet | not yet |
| Packaged installer with bundled tools | yes | not yet | not yet |

The macOS-only features use Apple's frameworks. Cross-platform versions are planned.

\* Windows and Linux support is new and still being tested: expect rough edges, and please report them.
Off macOS, shots that use cutouts play and export without them (text meant to go behind the person
shows in front, and backgrounds stay as filmed).

## Claude

The agent runs on whichever Claude you have:

- **Claude subscription**: install Claude Code and sign in with your own Claude plan, and the agent runs
  through it. No key needed. The app can install and update it from Settings → Claude, or:
  - macOS, Linux, WSL: `curl -fsSL https://claude.ai/install.sh | bash`, then `claude` to sign in
  - Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`, then `claude` to sign in
- **API key**: set `ANTHROPIC_API_KEY` in your environment or in a `.env` at the repo root (development)
  or in the app's data folder. Uses the Claude API directly.

Settings (the gear) can force one or the other, and pick how hard the agent thinks.

## What it does

- **Indexing** (on import, in the background): a 540p preview proxy (hardware encoded), audio
  measured (silences, loudness, waveform), every word transcribed locally with whisper.cpp and snapped
  to the measured silences, shot changes detected, and for music a beat map.
- **First cut**: drop clips into an empty project and the agent makes a draft as soon as indexing is
  done: retakes and dead air cut, best takes kept, hook title, caption emphasis, zooms.
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
