import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startMediaServer } from "./server.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-server-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("media server", () => {
  it("closes at once even while a client has stopped reading a video mid-stream", async () => {
    // Big enough that the response can't all sit in socket buffers: the stream stalls on the client.
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, Buffer.alloc(24 * 1024 * 1024));
    const server = await startMediaServer(async () => file);
    await new Promise<void>((ok) =>
      http.get(`${server.base}clip`, { headers: { range: "bytes=0-" } }, (res) => {
        res.once("data", () => {
          res.pause();
          ok();
        });
      }),
    );
    const closed = await Promise.race([
      server.close().then(() => "closed"),
      new Promise((ok) => setTimeout(() => ok("hung"), 3000)),
    ]);
    expect(closed).toBe("closed");
  });
});
