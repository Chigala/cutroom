/**
 * The open models the app runs where Apple's frameworks aren't there (Windows, Linux): face and person
 * detection, sound recognition and person cutouts, on ONNX Runtime. Each downloads once, the first time a
 * feature needs it, checked against a pinned hash, into VEDIT_MODELS (the app sets it to its data folder).
 * On Windows they run on the graphics card through DirectML (any GPU, integrated ones too), elsewhere on
 * the CPU. macOS keeps Apple's frameworks; VEDIT_VISION=onnx switches it to these, to compare them.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type * as Ort from "onnxruntime-node";
import { downloadReporter, downloadVerified } from "./downloads.ts";

export interface ModelFile {
  readonly file: string;
  readonly url: string;
  readonly sha256: string;
  /** Bytes, for download progress. */
  readonly size: number;
  readonly license: string;
}

export const MODELS = {
  /** YuNet (OpenCV), faces with landmarks: 640x640 BGR in. */
  faces: {
    file: "face_detection_yunet_2023mar.onnx",
    url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    size: 232_589,
    license: "MIT",
  },
  /** YOLOX-Nano (Megvii), the 80 COCO classes; we keep people: 416x416 BGR in. */
  people: {
    file: "yolox_nano.onnx",
    url: "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx",
    sha256: "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d",
    size: 3_659_407,
    license: "Apache-2.0",
  },
  /**
   * PANNs CNN14 (Kong et al.), the 527 AudioSet sounds in a stretch of 16 kHz audio. Chosen over the much
   * smaller YAMNet because it hears what's under speech (a laugh, music, typing), which is what editing needs.
   */
  sounds: {
    file: "Cnn14_16k.onnx",
    url: "https://huggingface.co/pranjal-pravesh/PANNs_CNN14_ONNX/resolve/bafe3efef3ea1ea7577ee915ac1407029eef339b/Cnn14_16k.onnx",
    sha256: "ad56b79861aaecc29a27e3e47923954de81418a181135f4d94de8d1a15e0fa9c",
    size: 86_649,
    license: "MIT",
  },
  /** Its weights, which ONNX Runtime loads from beside the model file (under this exact name). */
  soundsData: {
    file: "Cnn14_16k.onnx.data",
    url: "https://huggingface.co/pranjal-pravesh/PANNs_CNN14_ONNX/resolve/bafe3efef3ea1ea7577ee915ac1407029eef339b/Cnn14_16k.onnx.data",
    sha256: "d95f724232bb60b78c8e9ef3e031a599e00be33e8347fbbd6472f6e1348e6a8b",
    size: 327_483_392,
    license: "MIT",
  },
  /** AudioSet's class names (Google), in the order PANNs scores them. */
  soundLabels: {
    file: "class_labels_indices.csv",
    url: "https://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv/class_labels_indices.csv",
    sha256: "cdd1049833c4b86127c2773ac0d14a2754b6a6d0d1798002ed5c66e699708429",
    size: 14_675,
    license: "CC-BY-4.0",
  },
  /** Robust Video Matting (MobileNetV3): the person's alpha, frame after frame, steady between them. */
  cutouts: {
    file: "rvm_mobilenetv3_fp32.onnx",
    url: "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx",
    sha256: "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828",
    size: 14_975_696,
    license: "GPL-3.0",
  },
} as const satisfies Record<string, ModelFile>;

export type ModelName = keyof typeof MODELS;

/** What each model is for, as the download list says it. */
const PURPOSE: Record<ModelName, string> = {
  faces: "Face detection",
  people: "People tracking",
  sounds: "Sound recognition",
  soundsData: "Sound recognition",
  soundLabels: "Sound recognition",
  cutouts: "Person cutouts",
};

/** Platforms ONNX Runtime ships for. */
const ONNX_PLATFORMS = ["darwin-arm64", "darwin-x64", "win32-x64", "win32-arm64", "linux-x64", "linux-arm64"];

/**
 * Whether faces, people, sounds and cutouts come from these models rather than Apple's frameworks:
 * everywhere but macOS, where ONNX Runtime runs (and on a Mac when VEDIT_VISION=onnx).
 */
export const useOpenModels = () =>
  (process.platform !== "darwin" || process.env.VEDIT_VISION === "onnx") &&
  ONNX_PLATFORMS.includes(`${process.platform}-${process.arch}`);

/** Where models are kept: the app's data folder, or a cache folder outside the app (tests, scripts). */
export const modelsDir = () =>
  process.env.VEDIT_MODELS || path.join(homedir(), ".cache", "cutroom", "models");

const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

const fetching = new Map<string, Promise<string>>();
/** Files checked against their hash this session: a 330 MB model isn't read again for every clip. */
const verified = new Set<string>();

/** A model's file, downloaded and checked the first time it's needed (concurrent callers share one). */
export function ensureModel(name: ModelName, onProgress?: (fraction: number) => void): Promise<string> {
  const m: ModelFile = MODELS[name];
  const file = path.join(modelsDir(), m.file);
  let hit = fetching.get(file);
  if (!hit) {
    if (verified.has(file) && existsSync(file)) return Promise.resolve(file);
    hit = (async () => {
      if (!(existsSync(file) && (await sha256(file)) === m.sha256))
        await downloadVerified(
          m.url,
          file,
          m.sha256,
          downloadReporter(`model:${name}`, PURPOSE[name], m.size),
          onProgress,
        );
      verified.add(file);
      return file;
    })().finally(() => fetching.delete(file));
    fetching.set(file, hit);
  }
  return hit;
}

let runtime: Promise<typeof Ort> | null = null;
/** ONNX Runtime, loaded the first time a model runs (it's a native library, kept out of startup). */
export function onnx(): Promise<typeof Ort> {
  runtime ??= import("onnxruntime-node") as Promise<typeof Ort>;
  return runtime;
}

const sessions = new Map<ModelName, Promise<Ort.InferenceSession>>();

/**
 * A model ready to run: on Windows on the graphics card (DirectML), falling back to the CPU if that
 * doesn't start; elsewhere on the CPU. One per model, reused.
 */
export function session(
  name: Exclude<ModelName, "soundLabels" | "soundsData">,
): Promise<Ort.InferenceSession> {
  let s = sessions.get(name);
  if (!s) {
    s = (async () => {
      const ort = await onnx();
      // The sound model's weights live in a second file beside it.
      if (name === "sounds") await ensureModel("soundsData");
      const file = await ensureModel(name);
      if (process.platform === "win32")
        try {
          return await ort.InferenceSession.create(file, { executionProviders: ["dml", "cpu"] });
        } catch {}
      return ort.InferenceSession.create(file, { executionProviders: ["cpu"] });
    })().catch((err: unknown) => {
      sessions.delete(name);
      throw err;
    });
    sessions.set(name, s);
  }
  return s;
}
