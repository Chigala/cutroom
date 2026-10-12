import { describe, expect, it } from "vitest";
import { applyOps, emptyProject } from "./index.ts";
import { PHONE_PLATFORMS, platformRules, safeZoneFor } from "./safe-zone.ts";

describe("each phone platform's safe area", () => {
  it("has its own buttons and caption bar to keep clear of, not just TikTok", () => {
    for (const p of PHONE_PLATFORMS) {
      const z = safeZoneFor(p);
      expect(z.top).toBeGreaterThan(0);
      expect(z.bottom).toBeLessThan(1);
      expect(z.right).toBeLessThan(1);
      // The column of buttons starts below the top bar and above the caption bar.
      expect(z.rail).toBeGreaterThan(z.top);
      expect(z.rail).toBeLessThan(z.bottom);
    }
    expect(safeZoneFor("reels")).not.toEqual(safeZoneFor("tiktok"));
    expect(safeZoneFor("shorts")).not.toEqual(safeZoneFor("tiktok"));
  });

  it("is switched to by picking the platform, which drops a custom clear area", () => {
    const doc = emptyProject("t");
    const custom = { ...doc.checkRules, safeZone: { top: 0.2, bottom: 0.6, right: 0.7 } };
    const picked = platformRules(custom, "reels");
    expect(picked.platform).toBe("reels");
    expect(picked.safeZone).toBeUndefined();
    // The pick is a plain edit of checks.json, so it saves, syncs and undoes like any other.
    const next = applyOps(doc, [
      { op: "set", key: "checkRules", value: JSON.parse(JSON.stringify(picked)) },
    ]).doc;
    expect(next.checkRules.platform).toBe("reels");
    expect(next.checkRules.safeZone).toBeUndefined();
  });
});
