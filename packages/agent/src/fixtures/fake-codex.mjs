// A stand-in for `codex app-server`, for tests: answers the handshake, starts a thread, and in its turn
// streams a little text, calls one of Cutroom's tools, checks the answer and finishes.
import readline from "node:readline";

const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const pending = new Map();
let thread = null;
let next = 1000;
const mode = process.env.FAKE_CODEX_MODE;

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (m.id !== undefined && m.method === undefined) {
    pending.get(m.id)?.(m);
    return;
  }
  const reply = (result) => out({ id: m.id, result });
  switch (m.method) {
    case "initialize":
      return reply({ userAgent: "cutroom/0.155.0 (test)" });
    case "initialized":
      return;
    case "account/read":
      return reply({
        account: { type: "chatgpt", email: "a@b.c", planType: "plus" },
        requiresOpenaiAuth: true,
      });
    case "model/list":
      return reply({
        data: [
          {
            model: "gpt-test",
            displayName: "GPT Test",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }],
            defaultReasoningEffort: "medium",
          },
        ],
      });
    case "account/rateLimits/read":
      return reply({
        rateLimits: {
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1800000000 },
          secondary: null,
        },
      });
    case "thread/start":
      thread = m.params;
      return reply({ thread: { id: "t1" }, instructionSources: [], model: "gpt-test" });
    case "turn/start": {
      reply({ turn: { id: "u1" } });
      const p = m.params;
      // Ways a turn goes wrong (FAKE_CODEX_MODE): Codex dies mid-turn, or never answers again.
      if (mode === "crash") process.exit(3);
      if (mode === "hang") return;
      if (mode === "whole") {
        // A message that arrives only whole, with no deltas.
        out({ method: "item/started", params: { item: { type: "agentMessage", id: "w1" } } });
        out({
          method: "item/completed",
          params: { item: { type: "agentMessage", id: "w1", text: "All done." } },
        });
        out({
          method: "turn/completed",
          params: { threadId: "t1", turn: { id: "u1", status: "completed", error: null } },
        });
        return;
      }
      out({ method: "item/started", params: { item: { type: "agentMessage", id: "a1" } } });
      out({ method: "item/agentMessage/delta", params: { itemId: "a1", delta: "Looking " } });
      out({ method: "item/agentMessage/delta", params: { itemId: "a1", delta: "at it." } });
      const id = next++;
      const answer = await new Promise((resolve) => {
        pending.set(id, resolve);
        out({
          id,
          method: "item/tool/call",
          params: {
            threadId: "t1",
            turnId: "u1",
            callId: "c1",
            namespace: "cutroom",
            tool: "get_project",
            arguments: {},
          },
        });
      });
      const items = answer.result?.contentItems ?? [];
      const report = {
        locked: Array.isArray(thread.environments) && thread.environments.length === 0,
        tools: thread.dynamicTools?.[0]?.tools?.length ?? 0,
        prompt: typeof thread.baseInstructions === "string" && thread.baseInstructions.length > 1000,
        effort: p.effort,
        model: p.model,
        image: p.input.some((i) => i.type === "image" && i.url.startsWith("data:image/jpeg;base64,")),
        toolText: items.some((i) => i.type === "inputText" && i.text.length > 0),
        success: answer.result?.success,
      };
      out({
        method: "thread/tokenUsage/updated",
        params: { tokenUsage: { last: { totalTokens: 5000 }, modelContextWindow: 400000 } },
      });
      out({ method: "item/started", params: { item: { type: "agentMessage", id: "a2" } } });
      out({
        method: "item/agentMessage/delta",
        params: { itemId: "a2", delta: `Done. ${JSON.stringify(report)}` },
      });
      out({
        method: "turn/completed",
        params: { threadId: "t1", turn: { id: "u1", status: "completed", error: null } },
      });
      return;
    }
    case "turn/interrupt":
      // Hung: doesn't answer, doesn't end the turn.
      if (mode === "hang") return;
      return reply({});
    default:
      if (m.id !== undefined) out({ id: m.id, error: { code: -32601, message: `unknown ${m.method}` } });
  }
});
