// The node_modules the packaged app ships: the packages the main bundle leaves out (bundle.mjs: RUNTIME),
// at exactly the versions this repo uses, installed flat with npm for this platform and one architecture into
// .tmp/runtime (electron-builder copies it into the app; their native parts are unpacked from the archive).
//
//   node scripts/runtime-deps.mjs [--arch arm64|x64]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { desktopDir, RUNTIME } from "./bundle.mjs";

const args = process.argv.slice(2);
const arch = args.includes("--arch") ? args[args.indexOf("--arch") + 1] : process.arch;
const out = path.join(desktopDir, ".tmp", "runtime");

// Each package's version as installed in the workspace (resolved from the package that uses it).
const users = [
  "../../packages/render",
  "../../packages/agent",
  "../../packages/media",
  "../../packages/project",
];
// (Read from the package folder: some packages' export maps hide their package.json from require.)
const version = (name) => {
  for (const from of users) {
    const file = path.join(desktopDir, from, "node_modules", name, "package.json");
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).version;
  }
  throw new Error(`${name} isn't installed in the workspace`);
};
const dependencies = Object.fromEntries(RUNTIME.map((name) => [name, version(name)]));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(
  path.join(out, "package.json"),
  `${JSON.stringify({ name: "vedit-runtime", private: true, dependencies }, null, 2)}\n`,
);
console.log("runtime deps:", dependencies);
// npm is npm.cmd on Windows, which only runs through a shell.
const windows = process.platform === "win32";
execFileSync(
  windows ? "npm.cmd" : "npm",
  [
    "install",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--install-strategy=hoisted",
    `--os=${process.platform}`,
    `--cpu=${arch}`,
    // ONNX Runtime's install script would fetch NVIDIA's CUDA libraries on Linux: the app doesn't use them.
    "--onnxruntime-node-install=skip",
  ],
  { cwd: out, stdio: "inherit", shell: windows },
);
// ONNX Runtime ships its native library for every platform (~300 MB): keep only this one's.
const ortBin = path.join(out, "node_modules", "onnxruntime-node", "bin");
if (existsSync(ortBin))
  for (const napi of readdirSync(ortBin))
    for (const os of readdirSync(path.join(ortBin, napi)))
      for (const cpu of readdirSync(path.join(ortBin, napi, os)))
        if (os !== process.platform || cpu !== arch)
          rmSync(path.join(ortBin, napi, os, cpu), { recursive: true, force: true });
console.log(`runtime node_modules for ${process.platform}-${arch} in ${path.relative(process.cwd(), out)}`);
