# Working in this repo

- `pnpm check` must pass: Biome lint, `tsc` (TypeScript 7) per package, and Vitest.
- Packages are consumed as TypeScript source (`exports` point at `src/*.ts`); there is no package build step.
  Imports use explicit `.ts` extensions.
- The renderer is untrusted: anything crossing IPC is validated with zod in the main process
  (`CommitRequestSchema`, `AgentRequest`, `Settings`). Never expose Node or file paths to the page; media is
  served by key through the `media://` protocol.
- Every change to a project is an `Op` (`packages/project/src/ops.ts`), applied immutably and invertible.
  Don't mutate docs. New collections need a schema, a file in `layout.ts`, and a label in `summary.ts`.
- Transcripts and analysis are written only by the indexer (author `"index"`); the agent can't touch them.
- The agent's tools live once in `packages/agent/src/tools.ts` and serve both backends. Mutating tools
  call `commit()` so each call becomes one undoable change group.
- Preview and export render the same `VideoComposition`. Keep it deterministic: no `Date.now()`, no
  network, everything derived from props.
- Native-heavy deps (Agent SDK, Remotion renderer/bundler, whisper installer) are external to the main
  bundle (`apps/desktop/scripts/bundle.mjs`) and must stay direct dependencies of `@vedit/desktop`.
- `VEDIT_WHISPER_DIR` points indexing at an existing whisper.cpp install (saves the model download in dev).
