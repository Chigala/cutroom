import { describe, expect, it } from "vitest";
import { mergeMacManifests } from "./update-manifests.ts";

// As electron-builder writes them, one per Mac runner.
const ARM = `version: 0.2.0
files:
  - url: Cutroom-0.2.0-arm64.zip
    sha512: armzip==
    size: 200
  - url: Cutroom-0.2.0-arm64.dmg
    sha512: armdmg==
    size: 210
path: Cutroom-0.2.0-arm64.zip
sha512: armzip==
releaseDate: '2026-10-08T10:00:00.000Z'
`;
const INTEL = `version: 0.2.0\r
files:\r
  - url: Cutroom-0.2.0-x64.zip\r
    sha512: x64zip==\r
    size: 190\r
    blockMapSize: 12\r
  - url: Cutroom-0.2.0-x64.dmg\r
    sha512: x64dmg==\r
    size: 195\r
path: Cutroom-0.2.0-x64.zip\r
sha512: x64zip==\r
releaseDate: '2026-10-08T10:05:00.000Z'\r
`;

describe("mergeMacManifests", () => {
  it("names both architectures' files, each entry whole", () => {
    expect(mergeMacManifests([ARM, INTEL])).toBe(`version: 0.2.0
files:
  - url: Cutroom-0.2.0-arm64.zip
    sha512: armzip==
    size: 200
  - url: Cutroom-0.2.0-arm64.dmg
    sha512: armdmg==
    size: 210
  - url: Cutroom-0.2.0-x64.zip
    sha512: x64zip==
    size: 190
    blockMapSize: 12
  - url: Cutroom-0.2.0-x64.dmg
    sha512: x64dmg==
    size: 195
path: Cutroom-0.2.0-arm64.zip
sha512: armzip==
releaseDate: '2026-10-08T10:05:00.000Z'
`);
  });

  it("keeps one of a file named twice", () => {
    const merged = mergeMacManifests([ARM, ARM]);
    expect(merged.match(/- url:/g)).toHaveLength(2);
  });

  it("refuses manifests of different versions", () => {
    expect(() => mergeMacManifests([ARM, INTEL.replace("0.2.0", "0.2.1")])).toThrow(/different versions/);
  });
});
