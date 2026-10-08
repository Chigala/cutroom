import { describe, expect, it } from "vitest";
import { runScript } from "./script.ts";

describe("run_script's sandbox", () => {
  it("returns what the script returns, from the data and getters it's handed", async () => {
    const run = await runScript(
      `const words = transcript("c1");
console.log("words", words.length);
return { scenes: project.scenes.length, first: words[0].text, beats: beats.map((b) => b * 2) };`,
      { project: { scenes: [{ id: "a" }, { id: "b" }] }, beats: [0.5, 1] },
      { transcript: (id) => (id === "c1" ? [{ text: "Hello" }, { text: "there" }] : null) },
    );
    expect(run.error).toBeUndefined();
    expect(JSON.parse(run.json!)).toEqual({ scenes: 2, first: "Hello", beats: [1, 2] });
    expect(run.logs).toEqual(["words 2"]);
  });

  it("can't change what it's handed, or reach files, the network, timers or modules", async () => {
    const frozen = await runScript(
      `"use strict"; project.scenes.push(1); return 1;`,
      { project: { scenes: [] } },
      {},
    );
    expect(frozen.error).toMatch(/TypeError/);
    const reach = await runScript(
      `return [typeof fetch, typeof require, typeof process, typeof setTimeout, typeof XMLHttpRequest, typeof import.meta];`,
      {},
      {},
    );
    // import.meta isn't valid in a script at all.
    expect(reach.error).toMatch(/SyntaxError/);
    const globals = await runScript(
      `return [typeof fetch, typeof require, typeof process, typeof setTimeout, typeof XMLHttpRequest];`,
      {},
      {},
    );
    expect(JSON.parse(globals.json!)).toEqual([
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
    ]);
  });

  it("stops a script that runs too long or takes too much memory, and says where one threw", async () => {
    const forever = await runScript("while (true) {}", {}, {}, { ms: 200, memory: 32 * 1024 * 1024 });
    expect(forever.error).toMatch(/too long/);
    // A new megabyte every turn reaches the limit in a few turns.
    const hungry = await runScript(
      'const kept = []; const mb = "x".repeat(1 << 20); while (true) kept.push(mb + kept.length);',
      {},
      {},
      { ms: 5000, memory: 16 * 1024 * 1024 },
    );
    expect(hungry.error).toMatch(/memory/);
    const thrown = await runScript("const x = 1;\nreturn nope.y;", {}, {});
    expect(thrown.error).toMatch(/ReferenceError.*nope.*line 2/);
    // The sandbox is fresh every run: nothing carries over.
    await runScript("globalThis.kept = 1; return 1;", {}, {});
    expect((await runScript("return typeof kept;", {}, {})).json).toBe('"undefined"');
  });
});
