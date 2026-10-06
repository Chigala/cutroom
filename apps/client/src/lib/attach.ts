/**
 * Attachments: clips, images and screenshots dropped, pasted or picked into the text bar. Each one goes
 * into the project's library right away (so indexing starts while you type), without touching the cut,
 * and the message carries its source id: "put this after scene one when he talks about Google".
 */
import { create } from "zustand";
import { host } from "./host.ts";

export type AttachmentKind = "image" | "video" | "audio" | "other";

export interface Attachment {
  /** Local key, stable while the chip exists. */
  readonly key: string;
  readonly name: string;
  readonly kind: AttachmentKind;
  /** An object URL for the chip's thumbnail, before (and after) the file reaches the project. */
  readonly preview: string | null;
  readonly status: "uploading" | "ready" | "failed";
  readonly source: string | null;
  readonly error: string | null;
}

export const kindOf = (type: string, name = ""): AttachmentKind => {
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|avif)$/i.test(name)) return "image";
  if (type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(name)) return "video";
  if (type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(name)) return "audio";
  return "other";
};

let seq = 0;

export function pending(file: File): Attachment {
  const kind = kindOf(file.type, file.name);
  return {
    key: `a${Date.now().toString(36)}${++seq}`,
    // Pasted screenshots come in as "image.png": give them a name worth reading in the library.
    name:
      file.name && file.name !== "image.png"
        ? file.name
        : `Screenshot ${new Date().toLocaleTimeString()}.png`,
    kind,
    preview: kind === "image" || kind === "video" ? URL.createObjectURL(file) : null,
    status: "uploading",
    source: null,
    error: null,
  };
}

/** How many files are on their way into the project (switching projects waits for them). */
export const useUploads = create<{ count: number }>()(() => ({ count: 0 }));

/** Puts one file into the project's library. Files on disk are read in place; pasted data is saved. */
export async function upload(file: File, name: string): Promise<{ source: string } | { error: string }> {
  useUploads.setState((s) => ({ count: s.count + 1 }));
  try {
    const path = host.pathForFile(file);
    const result = path
      ? await host.project.attach([path])
      : await host.project.attachData(name, new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) return { error: result.error };
    const source = result.sources[0];
    return source ? { source } : { error: "That file couldn't be added" };
  } catch (err) {
    return { error: (err as Error).message };
  } finally {
    useUploads.setState((s) => ({ count: s.count - 1 }));
  }
}
