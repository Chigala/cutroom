/**
 * The agents that can edit: each a harness, the program that runs the conversation (a model, its loop,
 * the user's own sign-in) around the same Cutroom tools. Everything else (the tools, the prompt, the
 * project, what the chat shows) is the same whichever runs. Another harness is one more entry here: a
 * `run` that streams through BackendRun's callbacks and answers tool calls with runTool.
 */
import type { HarnessId } from "@vedit/bridge";
import { runWithCodex } from "./codex.ts";
import { runWithSubscription } from "./sdk.ts";
import type { ToolContext } from "./tools.ts";
import type { BackendRun } from "./types.ts";

export interface Harness {
  readonly id: HarnessId;
  /** Its name in what the chat says: "Claude stalled", "Codex isn't signed in". */
  readonly name: string;
  /** One request: the conversation over our tools, streamed through `run`. Returns the final reply. */
  run(run: BackendRun, ctx: ToolContext): Promise<string>;
}

export const HARNESSES: Readonly<Record<HarnessId, Harness>> = {
  claude: { id: "claude", name: "Claude", run: runWithSubscription },
  codex: { id: "codex", name: "Codex", run: runWithCodex },
};
