# AI-native video editor

You direct, the agent edits. Drop raw footage in, and the app understands it (every word said, pauses,
shots, beats). The agent makes the first cut on its own, and you change anything by saying what you
want, pointing at the video, or editing the words. Every change shows up as a chip you can keep or undo,
and the project is a real folder of plain files you can open in any editor.

```bash
pnpm install
pnpm dev            # the desktop app (Electron), with hot reload for the UI
pnpm dev:web        # the UI alone in a browser, on an in-memory demo project
pnpm check          # lint + typecheck + tests
pnpm build          # production build (includes the export renderer bundle)
pnpm dist           # package the app with electron-builder
```

Needs ffmpeg (`brew install ffmpeg`). Speech recognition (whisper.cpp) installs itself on first import.

## Claude

The agent runs on whichever Claude you have:

- **API key**: set `ANTHROPIC_API_KEY` in your environment or in a `.env` at the repo root (development)
  or in the app's data folder. Uses the Claude API directly.
- **Claude subscription**: no key needed. If you're signed in to Claude Code (`claude` in a terminal),
  the agent runs through the Claude Agent SDK on your plan.

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
