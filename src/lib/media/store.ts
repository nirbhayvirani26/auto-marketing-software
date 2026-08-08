/**
 * Media store — badhi image / video / audio file ahiya thi j pasar thay che.
 *
 * Be jagya e rahe che:
 *   disk   — `storage/media/...` — render pipeline ne local file joiye che
 *   public — Cloudinary/Catbox/etc — Meta ne download karva mate URL joiye che
 *
 * Etle "save karo" ek j call che, ane pachi jarur pade tyare public URL
 * lazily banave che.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { connectDB } from "@/lib/db";
import {
  MediaAsset,
  type MediaAssetDoc,
  type MediaAssetDocument,
} from "@/models/MediaAsset";
import { uploadPublic } from "./hosts";
import { apiFetch } from "@/lib/pipeline/chain";

export type MediaKind = "image" | "video" | "audio" | "other";
export type MediaRole = MediaAssetDoc["role"];

/** Badhi file ahiya rahe che — .gitignore ma che. */
export function mediaRoot(): string {
  return process.env.MEDIA_DIR
    ? path.resolve(process.env.MEDIA_DIR)
    : path.join(process.cwd(), "storage", "media");
}

/** Render vakhate vaparata temporary file mate. */
export function workRoot(): string {
  return path.join(mediaRoot(), "..", "work");
}

export async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
};

export function extensionFor(mimeType: string, fallback = ".bin"): string {
  return EXTENSIONS[mimeType.toLowerCase().split(";")[0].trim()] ?? fallback;
}

export function kindFor(mimeType: string): MediaKind {
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "other";
}

/** Filename ne surakshit banave — path traversal band. */
function safeName(name: string): string {
  return (
    path
      .basename(name)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80) || "file"
  );
}

export type SaveMediaInput = {
  data: Buffer;
  filename?: string;
  mimeType: string;
  role?: MediaRole;
  brand?: string;
  createdBy?: string;
  provider?: string;
  prompt?: string;
  duration?: number;
  width?: number;
  height?: number;
  /**
   * true  = turant public host par pan chadhavo (Meta ne aapva mate)
   * false = fakt disk par (intermediate file mate)
   */
  makePublic?: boolean;
  preferHost?: string;
};

/**
 * Buffer ne disk par lakhe, DB ma record banave, ane (kahyu hoy to)
 * public URL pan kadhi aape.
 */
export async function saveMedia(input: SaveMediaInput): Promise<MediaAssetDocument> {
  await connectDB();

  const kind = kindFor(input.mimeType);
  const ext = extensionFor(input.mimeType, path.extname(input.filename ?? "") || ".bin");
  const id = randomUUID();
  const base = safeName(input.filename ?? `${input.role ?? kind}${ext}`);
  const stored = `${id}-${base.endsWith(ext) ? base : base + ext}`;

  const bucket = new Date().toISOString().slice(0, 7); // 2026-08
  const dir = path.join(mediaRoot(), bucket);
  await ensureDir(dir);

  const localPath = path.join(dir, stored);
  await writeFile(localPath, input.data);

  let { width, height } = input;
  if (kind === "image" && (!width || !height)) {
    try {
      const meta = await sharp(input.data).metadata();
      width = meta.width;
      height = meta.height;
    } catch {
      // Metadata na madyu to vandho nahi — file to save thai gai che.
    }
  }

  const asset = await MediaAsset.create({
    brand: input.brand,
    kind,
    role: input.role ?? "other",
    filename: stored,
    mimeType: input.mimeType,
    bytes: input.data.length,
    localPath,
    width,
    height,
    duration: input.duration,
    provider: input.provider,
    prompt: input.prompt,
    host: "local",
    createdBy: input.createdBy,
  });

  if (input.makePublic) {
    await ensurePublicUrl(asset, input.preferHost);
  }

  return asset;
}

/**
 * Asset ne public URL aapo — nahi hoy to atyare j banavo.
 *
 * Kram:
 *   1. Pehle thi URL che ane hju valid che → e j
 *   2. PUBLIC_MEDIA_BASE_URL set che → aapno potano /api/media route
 *   3. Nahi to external host chain (Cloudinary → ImgBB → Catbox → tmpfiles)
 */
export async function ensurePublicUrl(
  asset: MediaAssetDocument,
  preferHost?: string,
): Promise<string> {
  const stillValid =
    asset.publicUrl &&
    (!asset.expiresAt || asset.expiresAt.getTime() > Date.now() + 60_000);
  if (stillValid) return asset.publicUrl as string;

  const base = (process.env.PUBLIC_MEDIA_BASE_URL || "").replace(/\/$/, "");
  if (base && /^https:\/\//i.test(base)) {
    const url = `${base}/api/media/${asset._id}`;
    asset.publicUrl = url;
    asset.host = "base-url";
    asset.expiresAt = undefined;
    await asset.save();
    return url;
  }

  const data = await readMediaBuffer(asset);
  const uploaded = await uploadPublic(
    {
      data,
      filename: asset.filename,
      mimeType: asset.mimeType,
      kind: asset.kind as MediaKind,
    },
    preferHost,
  );

  asset.publicUrl = uploaded.data.url;
  asset.host = uploaded.data.host;
  asset.expiresAt = uploaded.data.expiresAt;
  await asset.save();

  return uploaded.data.url;
}

/** Disk par thi asset ni file vanche. */
export async function readMediaBuffer(asset: MediaAssetDocument): Promise<Buffer> {
  if (asset.localPath && existsSync(asset.localPath)) {
    return readFile(asset.localPath);
  }
  if (asset.publicUrl) {
    // Local file gum thai gai pan public URL che — tya thi pachi lai laiye.
    return apiFetch<Buffer>(asset.publicUrl, { expect: "buffer" });
  }
  throw new Error(`Media file madi nahi: ${asset.filename}`);
}

/** Asset nu local path aapo — nahi hoy to public URL par thi download karo. */
export async function ensureLocalPath(asset: MediaAssetDocument): Promise<string> {
  if (asset.localPath && existsSync(asset.localPath)) return asset.localPath;

  const data = await readMediaBuffer(asset);
  const dir = path.join(mediaRoot(), "restored");
  await ensureDir(dir);
  const target = path.join(dir, asset.filename);
  await writeFile(target, data);

  asset.localPath = target;
  await asset.save();
  return target;
}

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024; // 200MB

/**
 * Bahar na URL par thi file lai ne aapna store ma mukhe.
 * Reference reel ke product page ni image mate vaparay che.
 */
export async function saveMediaFromUrl(
  url: string,
  input: Omit<SaveMediaInput, "data" | "mimeType"> & {
    mimeType?: string;
    /** Khaas headers joita hoy to (hotlink protection valі site mate). */
    headers?: Record<string, string>;
  },
): Promise<MediaAssetDocument> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Khotu URL: ${url.slice(0, 120)}`);
  }

  // Ghani site hotlink block kare che — Referer vagar 403 aape che.
  // Etle file je site par thi aave che e j site ne Referer tarike aapiye chie.
  const origin = (() => {
    try {
      return new URL(url).origin + "/";
    } catch {
      return undefined;
    }
  })();

  const response = await fetch(url, {
    signal: AbortSignal.timeout(180_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      accept: "*/*",
      ...(origin ? { referer: origin } : {}),
      ...(input.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Download fail (${response.status}): ${url.slice(0, 120)}`);
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File bahu moti che (${Math.round(declared / 1024 / 1024)}MB)`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_DOWNLOAD_BYTES) {
    throw new Error("File bahu moti che (200MB thi vadhare)");
  }

  const mimeType =
    input.mimeType ??
    (response.headers.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      .trim();

  const { headers: _headers, ...rest } = input;
  void _headers;

  return saveMedia({
    ...rest,
    data,
    mimeType,
    filename:
      input.filename ?? (path.basename(new URL(url).pathname) || "download"),
  });
}

/** Disk + DB banne mathi kadho. */
export async function deleteMedia(asset: MediaAssetDocument): Promise<void> {
  if (asset.localPath) {
    await unlink(asset.localPath).catch(() => undefined);
  }
  await MediaAsset.deleteOne({ _id: asset._id });
}

/** Disk par ni file ketli moti che. */
export async function mediaSize(asset: MediaAssetDocument): Promise<number> {
  if (asset.bytes) return asset.bytes;
  if (asset.localPath && existsSync(asset.localPath)) {
    return (await stat(asset.localPath)).size;
  }
  return 0;
}
