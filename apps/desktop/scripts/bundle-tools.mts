/**
 * Puts the tools the app ships into resources/tools/<platform>-<arch>, so a user's Mac needs nothing
 * installed: ffmpeg and ffprobe (static builds, checked against pinned hashes), whisper.cpp (built
 * here from a pinned release, one static binary with Metal), the voice cleaner (a pinned, checked
 * release) and the sound classifier (compiled here). Speech models are not bundled: they download
 * once, on first use, with progress (the best one is 1.6 GB).
 *
 *   pnpm --filter @vedit/desktop tools [--arch arm64|x64] [--force]
 *
 * Needs, on the build machine only: curl, unzip, git, cmake, Xcode's command line tools.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  compileHear,
  DEEP_FILTER_BINARIES,
  DEEP_FILTER_VERSION,
  ensureDeepFilter,
  WHISPER_VERSION,
} from "@vedit/media";

const args = process.argv.slice(2);
const arch = args.includes("--arch") ? args[args.indexOf("--arch") + 1]! : process.arch;
const force = args.includes("--force");
if (process.platform !== "darwin") throw new Error("The bundled tools are built on a Mac, for macOS.");
if (arch !== "arm64" && arch !== "x64") throw new Error(`Unknown arch ${arch}`);

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "resources", "tools", `darwin-${arch}`);
const cache = path.join(root, ".tmp", "tools-cache");
mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });

const sh = (cmd: string, argv: string[], cwd?: string) =>
  execFileSync(cmd, argv, { stdio: ["ignore", "inherit", "inherit"], ...(cwd && { cwd }) });
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const step = (s: string) => console.log(`\n▸ ${s}`);

/** Static ffmpeg and ffprobe for macOS, from https://ffmpeg.martin-riedl.de (GPL; signed builds). */
const FFMPEG_VERSION = "9.0.2";
const FFMPEG: Record<string, { path: string; sha256: Record<"ffmpeg" | "ffprobe", string> }> = {
  arm64: {
    path: "macos/arm64/1789931890_9.0.2",
    sha256: {
      ffmpeg: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
      ffprobe: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
    },
  },
};

/** Fails the build if a binary links anything but the system's libraries (it wouldn't run elsewhere). */
function selfContained(file: string) {
  const libs = execFileSync("otool", ["-L", file], { encoding: "utf8" })
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(" ")[0]!)
    .filter(Boolean);
  const foreign = libs.filter((l) => !l.startsWith("/System/") && !l.startsWith("/usr/lib/"));
  if (foreign.length)
    throw new Error(`${path.basename(file)} links libraries a user won't have: ${foreign.join(", ")}`);
}

const manifest: Record<string, unknown> = { arch, builtAt: new Date().toISOString() };

// 1. ffmpeg, ffprobe.
for (const tool of ["ffmpeg", "ffprobe"] as const) {
  const dest = path.join(out, tool);
  const pinned = FFMPEG[arch];
  if (!pinned) {
    console.warn(`No pinned ${tool} build for ${arch}: the app will use the machine's.`);
    continue;
  }
  if (!force && existsSync(dest)) {
    console.log(`✓ ${tool} (already there)`);
  } else {
    step(`${tool} ${FFMPEG_VERSION}`);
    const zip = path.join(cache, `${tool}-${FFMPEG_VERSION}-${arch}.zip`);
    if (!existsSync(zip) || sha256(zip) !== pinned.sha256[tool])
      sh("curl", [
        "-fL",
        "--retry",
        "3",
        "-o",
        zip,
        `https://ffmpeg.martin-riedl.de/download/${pinned.path}/${tool}.zip`,
      ]);
    if (sha256(zip) !== pinned.sha256[tool])
      throw new Error(`${tool} download doesn't match its pinned hash`);
    sh("unzip", ["-oq", zip, tool, "-d", out]);
    chmodSync(dest, 0o755);
  }
  selfContained(dest);
  manifest[tool] = { version: FFMPEG_VERSION, source: "https://ffmpeg.martin-riedl.de", license: "GPL-3.0" };
}

// 2. whisper.cpp: built from the pinned release, statically, with the Metal shaders embedded.
{
  const dest = path.join(out, "whisper", "build", "bin", "whisper-cli");
  if (!force && existsSync(dest)) {
    console.log("✓ whisper-cli (already there)");
  } else {
    step(`whisper.cpp ${WHISPER_VERSION}`);
    const src = path.join(cache, `whisper.cpp-${WHISPER_VERSION}`);
    if (!existsSync(path.join(src, "CMakeLists.txt")))
      sh("git", [
        "clone",
        "--depth",
        "1",
        "--branch",
        `v${WHISPER_VERSION}`,
        "https://github.com/ggml-org/whisper.cpp.git",
        src,
      ]);
    const build = path.join(src, `build-${arch}`);
    sh("cmake", [
      "-S",
      src,
      "-B",
      build,
      "-DCMAKE_BUILD_TYPE=Release",
      `-DCMAKE_OSX_ARCHITECTURES=${arch === "arm64" ? "arm64" : "x86_64"}`,
      "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.3",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DGGML_METAL=ON",
      "-DGGML_METAL_EMBED_LIBRARY=ON",
      "-DGGML_NATIVE=OFF",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DWHISPER_BUILD_SERVER=OFF",
    ]);
    sh("cmake", ["--build", build, "--config", "Release", "--target", "whisper-cli", "-j"]);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(build, "bin", "whisper-cli"), dest);
    chmodSync(dest, 0o755);
    copyFileSync(path.join(src, "LICENSE"), path.join(out, "whisper", "LICENSE"));
  }
  selfContained(dest);
  manifest.whisper = {
    version: WHISPER_VERSION,
    source: "https://github.com/ggml-org/whisper.cpp",
    license: "MIT",
  };
}

// 3. The voice cleaner (DeepFilterNet), checked against its pinned hash.
{
  const dest = path.join(out, "deep-filter");
  const platform = `darwin-${arch}`;
  if (!DEEP_FILTER_BINARIES[platform]) {
    console.warn(`No checked voice cleaner for ${platform}: voices won't be neurally cleaned on it.`);
  } else if (!force && existsSync(dest)) {
    console.log("✓ deep-filter (already there)");
  } else {
    step(`deep-filter ${DEEP_FILTER_VERSION}`);
    // Not from the tools folder we're filling: from GitHub, verified.
    const saved = process.env.VEDIT_TOOLS;
    delete process.env.VEDIT_TOOLS;
    const file = await ensureDeepFilter(cache, platform);
    if (saved) process.env.VEDIT_TOOLS = saved;
    if (!file) throw new Error("The voice cleaner didn't download");
    copyFileSync(file, dest);
    chmodSync(dest, 0o755);
  }
  if (existsSync(dest))
    manifest.deepFilter = {
      version: DEEP_FILTER_VERSION,
      source: "https://github.com/Rikorose/DeepFilterNet",
      license: "MIT OR Apache-2.0",
    };
}

// 4. The sound classifier (Apple's SoundAnalysis), compiled here so users need no developer tools.
{
  const dest = path.join(out, "hear");
  if (!force && existsSync(dest)) {
    console.log("✓ hear (already there)");
  } else {
    step("the sound classifier");
    await compileHear(dest, arch === "arm64" ? "arm64-apple-macos13.3" : "x86_64-apple-macos13.3");
  }
  selfContained(dest);
  manifest.hear = { source: "packages/media/src/hear.ts" };
}

// Notices: what ships, under which licence, and where its source is (the GPL asks for that).
writeFileSync(
  path.join(out, "NOTICES.txt"),
  `Third-party tools bundled with Video Editor

ffmpeg and ffprobe ${FFMPEG_VERSION}
  Licensed under the GNU General Public License v3 (built with libx264, libx265 and others).
  Unmodified builds from https://ffmpeg.martin-riedl.de; source: https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz
  They run as separate programs; Video Editor calls them, it does not link them.

whisper.cpp ${WHISPER_VERSION}
  MIT License (see whisper/LICENSE). Source: https://github.com/ggml-org/whisper.cpp/tree/v${WHISPER_VERSION}

DeepFilterNet ${DEEP_FILTER_VERSION} (deep-filter)
  MIT OR Apache-2.0. Source: https://github.com/Rikorose/DeepFilterNet/tree/v${DEEP_FILTER_VERSION}
`,
);
writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(path.join(out, ".DS_Store"), { force: true });
console.log(`\nTools for darwin-${arch} are in ${path.relative(process.cwd(), out)}`);
