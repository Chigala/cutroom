/**
 * Puts the tools the app ships into resources/tools/<platform>-<arch>, so users need nothing installed:
 * ffmpeg and ffprobe (static builds, checked against pinned hashes), whisper.cpp (built here from a
 * pinned release: Metal on macOS, the CPU elsewhere), the voice cleaner (a pinned, checked release)
 * and, on macOS, the sound classifier (compiled here). Speech models are not bundled: they download
 * once, on first use, with progress (the best one is 1.6 GB).
 *
 *   pnpm --filter @vedit/desktop tools [--arch arm64|x64] [--force]
 *
 * Runs on the system it builds for (CI builds each platform on its own OS). Needs, on the build machine
 * only: curl, git, cmake and a C++ compiler (Xcode's command line tools on macOS, Visual Studio's C++
 * tools on Windows, build-essential on Linux), plus unzip on macOS and Linux.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const platform = process.platform;
if (platform !== "darwin" && platform !== "win32" && platform !== "linux")
  throw new Error(`No bundled tools for ${platform}`);
if (arch !== "arm64" && arch !== "x64") throw new Error(`Unknown arch ${arch}`);
const target = `${platform}-${arch}`;
const windows = platform === "win32";
/** A program's file name here: Windows ones end in .exe. */
const exe = (name: string) => (windows ? `${name}.exe` : name);

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "resources", "tools", target);
const cache = path.join(root, ".tmp", "tools-cache");
mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });

const sh = (cmd: string, argv: string[], cwd?: string) =>
  execFileSync(cmd, argv, { stdio: ["ignore", "inherit", "inherit"], ...(cwd && { cwd }) });
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const step = (s: string) => console.log(`\n▸ ${s}`);

/**
 * Static ffmpeg and ffprobe, version-pinned and checked. macOS and Linux: https://ffmpeg.martin-riedl.de
 * (one zip per program, hashes as the site publishes them). Windows: Gyan's builds as released on
 * GitHub (both programs in one zip, hash as GitHub publishes it).
 */
const FFMPEG_VERSION = "9.0.2";
interface Pin {
  readonly url: string;
  readonly sha256: string;
  /** The program's path inside the zip. */
  readonly member: string;
}
const riedl = (dir: string, tool: string, hash: string): Pin => ({
  url: `https://ffmpeg.martin-riedl.de/download/${dir}/${tool}.zip`,
  sha256: hash,
  member: tool,
});
const GYAN_ZIP = `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`;
const GYAN_SHA = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
const FFMPEG: Partial<Record<string, Record<"ffmpeg" | "ffprobe", Pin>>> = {
  "darwin-arm64": {
    ffmpeg: riedl(
      "macos/arm64/1789931890_9.0.2",
      "ffmpeg",
      "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
    ),
    ffprobe: riedl(
      "macos/arm64/1789931890_9.0.2",
      "ffprobe",
      "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
    ),
  },
  "darwin-x64": {
    ffmpeg: riedl(
      "macos/amd64/1789931006_9.0.2",
      "ffmpeg",
      "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
    ),
    ffprobe: riedl(
      "macos/amd64/1789931006_9.0.2",
      "ffprobe",
      "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd",
    ),
  },
  "linux-x64": {
    ffmpeg: riedl(
      "linux/amd64/1789931100_9.0.2",
      "ffmpeg",
      "fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f",
    ),
    ffprobe: riedl(
      "linux/amd64/1789931100_9.0.2",
      "ffprobe",
      "3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32",
    ),
  },
  "linux-arm64": {
    ffmpeg: riedl(
      "linux/arm64/1789931697_9.0.2",
      "ffmpeg",
      "93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b",
    ),
    ffprobe: riedl(
      "linux/arm64/1789931697_9.0.2",
      "ffprobe",
      "bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330",
    ),
  },
  "win32-x64": {
    ffmpeg: {
      url: GYAN_ZIP,
      sha256: GYAN_SHA,
      member: `ffmpeg-${FFMPEG_VERSION}-essentials_build/bin/ffmpeg.exe`,
    },
    ffprobe: {
      url: GYAN_ZIP,
      sha256: GYAN_SHA,
      member: `ffmpeg-${FFMPEG_VERSION}-essentials_build/bin/ffprobe.exe`,
    },
  },
};
const FFMPEG_SOURCE = windows ? "https://github.com/GyanD/codexffmpeg" : "https://ffmpeg.martin-riedl.de";

/** A file from a pinned zip, downloaded once into the cache and checked. */
function fromZip(pin: Pin, dest: string) {
  const zip = path.join(cache, `${createHash("sha256").update(pin.url).digest("hex").slice(0, 16)}.zip`);
  if (!existsSync(zip) || sha256(zip) !== pin.sha256) sh("curl", ["-fL", "--retry", "3", "-o", zip, pin.url]);
  if (sha256(zip) !== pin.sha256) throw new Error(`${pin.url} doesn't match its pinned hash`);
  if (windows) {
    // Windows' own tar reads zips (unzip isn't there).
    const tmp = mkdtempSync(path.join(cache, "unzip-"));
    sh("tar", ["-xf", zip, "-C", tmp, pin.member]);
    copyFileSync(path.join(tmp, ...pin.member.split("/")), dest);
    rmSync(tmp, { recursive: true, force: true });
  } else {
    sh("unzip", ["-ojq", zip, pin.member, "-d", path.dirname(dest)]);
    const unpacked = path.join(path.dirname(dest), path.basename(pin.member));
    if (unpacked !== dest) copyFileSync(unpacked, dest);
    chmodSync(dest, 0o755);
  }
}

/**
 * Fails the build if a binary needs libraries a user won't have. macOS: only the system's. Linux: only
 * glibc's own (static builds pass). Windows has no stock tool for this; its builds link statically.
 */
function selfContained(file: string) {
  if (platform === "darwin") {
    const libs = execFileSync("otool", ["-L", file], { encoding: "utf8" })
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(" ")[0]!)
      .filter(Boolean);
    const foreign = libs.filter((l) => !l.startsWith("/System/") && !l.startsWith("/usr/lib/"));
    if (foreign.length)
      throw new Error(`${path.basename(file)} links libraries a user won't have: ${foreign.join(", ")}`);
  } else if (platform === "linux") {
    let text: string;
    try {
      text = execFileSync("ldd", [file], { encoding: "utf8" });
    } catch (err) {
      // ldd says so (and fails) for a static binary: nothing to need.
      text = String((err as { stdout?: string }).stdout ?? "");
      if (/not a dynamic executable|statically linked/.test(text)) return;
      throw err;
    }
    if (/statically linked/.test(text)) return;
    const SYSTEM = /^(linux-vdso|ld-linux|libc|libm|libpthread|libdl|librt|libresolv)\b/;
    const foreign = text
      .split("\n")
      .map((l) => l.trim().split(" ")[0]!)
      .filter((l) => l && !l.startsWith("/") && !SYSTEM.test(l));
    if (foreign.length)
      throw new Error(`${path.basename(file)} links libraries a user won't have: ${foreign.join(", ")}`);
  }
}

const manifest: Record<string, unknown> = { platform, arch, builtAt: new Date().toISOString() };

// 1. ffmpeg, ffprobe.
for (const tool of ["ffmpeg", "ffprobe"] as const) {
  const dest = path.join(out, exe(tool));
  const pin = FFMPEG[target]?.[tool];
  if (!pin) {
    console.warn(`No pinned ${tool} build for ${target}: the app will use the machine's.`);
    continue;
  }
  if (!force && existsSync(dest)) {
    console.log(`✓ ${tool} (already there)`);
  } else {
    step(`${tool} ${FFMPEG_VERSION}`);
    fromZip(pin, dest);
  }
  selfContained(dest);
  manifest[tool] = { version: FFMPEG_VERSION, source: FFMPEG_SOURCE, license: "GPL-3.0" };
}

// 2. whisper.cpp, built from the pinned release into one static program: on macOS with the Metal shaders
// embedded; elsewhere for the CPU, with the vector instructions every x64 PC of the last decade has.
{
  const dest = path.join(out, "whisper", "build", "bin", exe("whisper-cli"));
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
    const build = path.join(src, `build-${target}`);
    const flags = [
      "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DGGML_NATIVE=OFF",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DWHISPER_BUILD_SERVER=OFF",
    ];
    if (platform === "darwin")
      flags.push(
        `-DCMAKE_OSX_ARCHITECTURES=${arch === "arm64" ? "arm64" : "x86_64"}`,
        "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.3",
        "-DGGML_METAL=ON",
        "-DGGML_METAL_EMBED_LIBRARY=ON",
      );
    else {
      // No OpenMP: its runtime library wouldn't be on the user's machine (ggml has its own threads).
      flags.push("-DGGML_OPENMP=OFF");
      if (arch === "x64") flags.push("-DGGML_AVX=ON", "-DGGML_AVX2=ON", "-DGGML_FMA=ON", "-DGGML_F16C=ON");
    }
    if (platform === "linux") flags.push("-DCMAKE_EXE_LINKER_FLAGS=-static-libgcc -static-libstdc++");
    // The C runtime linked in, so the user doesn't need Visual C++'s redistributable.
    if (windows)
      flags.push("-DCMAKE_POLICY_DEFAULT_CMP0091=NEW", "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");
    sh("cmake", ["-S", src, "-B", build, ...flags]);
    sh("cmake", ["--build", build, "--config", "Release", "--target", "whisper-cli", "-j"]);
    // Visual Studio's generator puts it in a per-configuration folder.
    const built = [
      path.join(build, "bin", exe("whisper-cli")),
      path.join(build, "bin", "Release", exe("whisper-cli")),
    ].find(existsSync);
    if (!built) throw new Error("whisper-cli didn't build");
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(built, dest);
    if (!windows) chmodSync(dest, 0o755);
    copyFileSync(path.join(src, "LICENSE"), path.join(out, "whisper", "LICENSE"));
  }
  selfContained(dest);
  manifest.whisper = {
    version: WHISPER_VERSION,
    source: "https://github.com/ggml-org/whisper.cpp",
    license: "MIT",
    accelerated: platform === "darwin" ? "Metal" : "CPU",
  };
}

// 3. The voice cleaner (DeepFilterNet), checked against its pinned hash.
{
  const dest = path.join(out, exe("deep-filter"));
  if (!DEEP_FILTER_BINARIES[target]) {
    console.warn(`No checked voice cleaner for ${target}: voices won't be neurally cleaned on it.`);
  } else if (!force && existsSync(dest)) {
    console.log("✓ deep-filter (already there)");
  } else {
    step(`deep-filter ${DEEP_FILTER_VERSION}`);
    // Not from the tools folder we're filling: from GitHub, verified.
    const saved = process.env.VEDIT_TOOLS;
    delete process.env.VEDIT_TOOLS;
    const file = await ensureDeepFilter(cache, target);
    if (saved) process.env.VEDIT_TOOLS = saved;
    if (!file) throw new Error("The voice cleaner didn't download");
    copyFileSync(file, dest);
    if (!windows) chmodSync(dest, 0o755);
  }
  if (existsSync(dest))
    manifest.deepFilter = {
      version: DEEP_FILTER_VERSION,
      source: "https://github.com/Rikorose/DeepFilterNet",
      license: "MIT OR Apache-2.0",
    };
}

// 4. The sound classifier (Apple's SoundAnalysis), compiled here so users need no developer tools.
if (platform === "darwin") {
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
  `Third-party tools bundled with Cutroom

ffmpeg and ffprobe ${FFMPEG_VERSION}
  Licensed under the GNU General Public License v3 (built with libx264, libx265 and others).
  Unmodified builds from ${FFMPEG_SOURCE}; source: https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz
  They run as separate programs; Cutroom calls them, it does not link them.

whisper.cpp ${WHISPER_VERSION}
  MIT License (see whisper/LICENSE). Source: https://github.com/ggml-org/whisper.cpp/tree/v${WHISPER_VERSION}

DeepFilterNet ${DEEP_FILTER_VERSION} (deep-filter)
  MIT OR Apache-2.0. Source: https://github.com/Rikorose/DeepFilterNet/tree/v${DEEP_FILTER_VERSION}
`,
);
writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(path.join(out, ".DS_Store"), { force: true });
console.log(`\nTools for ${target} are in ${path.relative(process.cwd(), out)}`);
