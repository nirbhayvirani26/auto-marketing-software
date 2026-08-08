/**
 * Public hosting — Instagram/Facebook ne file aapva mate.
 *
 * ⚠️ Aa aakha system nu sauthi motu "gotcha": Meta na server aapni file
 * download kare che. Etle `http://localhost:3000/...` KYAREY nahi chale —
 * public https URL joiye j.
 *
 * Etle ahiya ek chain rakhi che. Uper thi niche — je configure hoy e chale:
 *
 *   1. cloudinary — best (free 25GB, saacho CDN, video support, kayami URL)
 *   2. imgbb      — free key, fakt image
 *   3. catbox     — koi key nahi, image + video, anonymous
 *   4. tmpfiles   — koi key nahi, 1 kalak ni file (chhelli aasha)
 *   5. base-url   — tamaru potanu domain / ngrok tunnel
 *
 * Ek pan na chale to samjay evo error aave che — chup-chaap fail nahi.
 */

import { apiFetch, runChain, FatalError, type ChainResult } from "@/lib/pipeline/chain";

export type UploadedFile = {
  url: string;
  host: string;
  /** Aa URL kyare khatam thashe (khabar hoy to). */
  expiresAt?: Date;
};

export type UploadInput = {
  data: Buffer;
  filename: string;
  mimeType: string;
  kind: "image" | "video" | "audio" | "other";
};

/* ------------------------------------------------------------------ *
 *  Cloudinary — recommended
 * ------------------------------------------------------------------ */

function cloudinaryConfig() {
  return {
    cloud: process.env.CLOUDINARY_CLOUD_NAME || "",
    preset: process.env.CLOUDINARY_UPLOAD_PRESET || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  };
}

function cloudinaryConfigured(): boolean {
  const c = cloudinaryConfig();
  return Boolean(c.cloud && (c.preset || (c.apiKey && c.apiSecret)));
}

async function uploadToCloudinary(
  input: UploadInput,
  signal: AbortSignal,
): Promise<UploadedFile> {
  const c = cloudinaryConfig();
  const resourceType = input.kind === "video" || input.kind === "audio" ? "video" : "image";
  const url = `https://api.cloudinary.com/v1_1/${c.cloud}/${resourceType}/upload`;

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.data)], { type: input.mimeType }), input.filename);

  if (c.preset) {
    // Unsigned upload — sauthi saral, fakt preset joiye.
    form.append("upload_preset", c.preset);
  } else {
    // Signed upload — api key + secret thi signature banaviye.
    const timestamp = Math.floor(Date.now() / 1000);
    const { createHash } = await import("node:crypto");
    const signature = createHash("sha1")
      .update(`timestamp=${timestamp}${c.apiSecret}`)
      .digest("hex");
    form.append("api_key", c.apiKey);
    form.append("timestamp", String(timestamp));
    form.append("signature", signature);
  }

  const json = await apiFetch<{ secure_url?: string; error?: { message: string } }>(url, {
    method: "POST",
    body: form,
    signal,
  });

  if (!json.secure_url) {
    throw new FatalError(`Cloudinary: ${json.error?.message ?? "URL na madyu"}`);
  }
  return { url: json.secure_url, host: "cloudinary" };
}

/* ------------------------------------------------------------------ *
 *  ImgBB — free key, fakt image
 * ------------------------------------------------------------------ */

async function uploadToImgbb(
  input: UploadInput,
  signal: AbortSignal,
): Promise<UploadedFile> {
  const key = process.env.IMGBB_API_KEY || "";
  const form = new FormData();
  form.append("image", input.data.toString("base64"));
  form.append("name", input.filename.replace(/\.[^.]+$/, ""));

  const json = await apiFetch<{
    data?: { url?: string; display_url?: string };
    error?: { message: string };
  }>(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
    method: "POST",
    body: form,
    signal,
  });

  const url = json.data?.display_url ?? json.data?.url;
  if (!url) throw new FatalError(`ImgBB: ${json.error?.message ?? "URL na madyu"}`);
  return { url, host: "imgbb" };
}

/* ------------------------------------------------------------------ *
 *  Catbox — koi key nahi, image + video (200MB sudhi)
 * ------------------------------------------------------------------ */

async function uploadToCatbox(
  input: UploadInput,
  signal: AbortSignal,
): Promise<UploadedFile> {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append(
    "fileToUpload",
    new Blob([new Uint8Array(input.data)], { type: input.mimeType }),
    input.filename,
  );

  const text = await apiFetch<string>("https://catbox.moe/user/api.php", {
    method: "POST",
    body: form,
    signal,
    expect: "text",
  });

  const url = text.trim();
  if (!url.startsWith("https://")) {
    throw new FatalError(`Catbox: ${url.slice(0, 200)}`);
  }
  return { url, host: "catbox" };
}

/* ------------------------------------------------------------------ *
 *  tmpfiles.org — koi key nahi, 60 minute sudhi rahe
 * ------------------------------------------------------------------ */

async function uploadToTmpfiles(
  input: UploadInput,
  signal: AbortSignal,
): Promise<UploadedFile> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.data)], { type: input.mimeType }),
    input.filename,
  );

  const json = await apiFetch<{ data?: { url?: string }; status?: string }>(
    "https://tmpfiles.org/api/v1/upload",
    { method: "POST", body: form, signal },
  );

  const page = json.data?.url;
  if (!page) throw new FatalError("tmpfiles: URL na madyu");

  // tmpfiles page URL aape che — direct download mate `/dl/` umervu pade.
  const direct = page.replace("tmpfiles.org/", "tmpfiles.org/dl/");
  return {
    url: direct,
    host: "tmpfiles",
    expiresAt: new Date(Date.now() + 55 * 60_000),
  };
}

/* ------------------------------------------------------------------ *
 *  Chain
 * ------------------------------------------------------------------ */

export type PublicHostKey =
  | "cloudinary"
  | "imgbb"
  | "catbox"
  | "tmpfiles"
  | "base-url";

/**
 * File ne public URL par mukho. Configure thayela hosts kram ma try thay che.
 *
 * `preferHost` aapo to e pehla try thay (setup page ni pasandgi).
 */
export async function uploadPublic(
  input: UploadInput,
  preferHost?: string,
): Promise<ChainResult<UploadedFile>> {
  const isImage = input.kind === "image";

  return runChain<UploadedFile>(
    [
      {
        name: "cloudinary",
        label: "Cloudinary (free 25GB CDN)",
        free: true,
        configured: cloudinaryConfigured,
        run: (signal) => uploadToCloudinary(input, signal),
        timeoutMs: 180_000,
      },
      {
        name: "imgbb",
        label: "ImgBB (free, fakt image)",
        free: true,
        configured: () => Boolean(process.env.IMGBB_API_KEY) && isImage,
        run: (signal) => uploadToImgbb(input, signal),
        timeoutMs: 120_000,
      },
      {
        name: "catbox",
        label: "Catbox (key vagar)",
        free: true,
        configured: () => process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
        run: (signal) => uploadToCatbox(input, signal),
        timeoutMs: 180_000,
      },
      {
        name: "tmpfiles",
        label: "tmpfiles.org (key vagar, 1 kalak)",
        free: true,
        configured: () => process.env.MEDIA_ALLOW_ANON_HOSTS !== "false",
        run: (signal) => uploadToTmpfiles(input, signal),
        timeoutMs: 180_000,
      },
    ],
    {
      label: "Public media hosting",
      prefer: preferHost ?? process.env.MEDIA_HOST,
      retries: 1,
      backoffMs: 1200,
    },
  );
}

/** Setup page mate — kayo host taiyar che. */
export function hostStatus() {
  const anon = process.env.MEDIA_ALLOW_ANON_HOSTS !== "false";
  return [
    {
      key: "cloudinary" as const,
      label: "Cloudinary",
      free: true,
      configured: cloudinaryConfigured(),
      recommended: true,
      note: "Sauthi saaru — free 25GB, video support, kayami URL. cloudinary.com par signup → Settings → Upload → unsigned preset banavo.",
    },
    {
      key: "imgbb" as const,
      label: "ImgBB",
      free: true,
      configured: Boolean(process.env.IMGBB_API_KEY),
      recommended: false,
      note: "Fakt image. api.imgbb.com par thi free key.",
    },
    {
      key: "catbox" as const,
      label: "Catbox",
      free: true,
      configured: anon,
      recommended: false,
      note: "Koi key nahi — turant chale. Image + video.",
    },
    {
      key: "tmpfiles" as const,
      label: "tmpfiles.org",
      free: true,
      configured: anon,
      recommended: false,
      note: "Koi key nahi, pan file fakt 1 kalak rahe che. Chhelli aasha.",
    },
    {
      key: "base-url" as const,
      label: "Potanu domain / tunnel",
      free: true,
      configured: Boolean(process.env.PUBLIC_MEDIA_BASE_URL),
      recommended: false,
      note: "PUBLIC_MEDIA_BASE_URL set karo (dakhla tarike ngrok ke tamaru domain) to /api/media sidhu vaparashe.",
    },
  ];
}
