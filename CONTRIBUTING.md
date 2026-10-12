# Contributing to Cutroom

Thanks for helping. A few things make a pull request easy to take.

## Before you start

- For a bug, open an issue with what you did, what you expected and what happened. A short clip or the
  project folder (if you can share it) helps most.
- For anything bigger than a fix, open an issue first so we can agree on the approach before you build
  it.

## Setting up

Follow [docs/development.md](docs/development.md). `pnpm dev` runs the desktop app with hot reload;
`pnpm dev:web` runs the UI alone in a browser on a demo project, which is the fastest way to work on
the interface.

## The rules of the codebase

- `pnpm check` must pass: Biome (lint and format), TypeScript per package, and Vitest.
- Every change to a project is an `Op` (`packages/project/src/ops.ts`), applied immutably and
  invertible. Don't mutate docs.
- Preview and export render the same composition. Keep it deterministic: no `Date.now()`, no network,
  everything derived from props.
- The renderer is untrusted: anything crossing IPC is validated in the main process. Never expose Node
  or file paths to the page.
- Everything must work on macOS, Windows and Linux. If you can only test one, say which in the pull
  request.
- Fixing a bug? Add a test that fails without your fix.

[CLAUDE.md](CLAUDE.md) has the full list, written for coding agents and just as useful for people.

## Pull requests

Keep each one to a single change, describe what it does and how you checked it, and include a
screenshot or a short recording for anything you can see.

By contributing, you agree that your contributions are licensed under the
[GNU AGPL-3.0](LICENSE), the same license as the project.
