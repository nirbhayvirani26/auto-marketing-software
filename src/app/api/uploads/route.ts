import { fail, handle, ok, requireBrand } from "@/lib/api";
import { saveMedia, type MediaRole } from "@/lib/media/store";
import { MediaAsset } from "@/models/MediaAsset";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;   // 25MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;  // 200MB

const ALLOWED = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
  "video/mp4", "video/quicktime", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/wav",
]);

/**
 * File upload — product images, avatar photos, reference reels, music.
 *
 * Image ne ahiya j saaf kari daiye chie:
 *   • EXIF rotation lagavi daiye (phone na photo aada na dekhaay)
 *   • HEIC/WebP ne JPEG ma badli daiye (ffmpeg ane Meta banne samje)
 *   • 4000px thi moti hoy to nani karie (render ghano fast thay)
 *
 * `makePublic=true` hoy to turant public URL pan banavi aapiye chie.
 */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) return fail("Ek pan file na madi", 400);
  if (files.length > 20) return fail("Ek var ma 20 thi vadhare file nahi", 400);

  const role = (form.get("role") as MediaRole | null) ?? "product";
  const makePublic = form.get("makePublic") === "true";

  const saved = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const type = (file.type || "application/octet-stream").toLowerCase();
      if (!ALLOWED.has(type)) {
        errors.push(`${file.name}: aa format support nathi (${type})`);
        continue;
      }

      const isVideo = type.startsWith("video/");
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (file.size > limit) {
        errors.push(
          `${file.name}: bahu moti che (${(file.size / 1024 / 1024).toFixed(1)}MB, limit ${limit / 1024 / 1024}MB)`,
        );
        continue;
      }

      let data = Buffer.from(await file.arrayBuffer());
      let mimeType = type;
      let width: number | undefined;
      let height: number | undefined;

      if (type.startsWith("image/")) {
        try {
          const image = sharp(data).rotate();
          const meta = await image.metadata();

          const needsResize = (meta.width ?? 0) > 4000 || (meta.height ?? 0) > 4000;
          const needsConvert = !["jpeg", "png"].includes(meta.format ?? "");

          if (needsResize || needsConvert || meta.orientation) {
            data = await image
              .resize(4000, 4000, { fit: "inside", withoutEnlargement: true })
              .jpeg({ quality: 92 })
              .toBuffer();
            mimeType = "image/jpeg";
          }

          const finalMeta = await sharp(data).metadata();
          width = finalMeta.width;
          height = finalMeta.height;
        } catch (error) {
          errors.push(`${file.name}: image vanchi na shakai (${(error as Error).message})`);
          continue;
        }
      }

      const asset = await saveMedia({
        data,
        filename: file.name,
        mimeType,
        role,
        brand: ctx.brandId,
        createdBy: ctx.session.sub,
        provider: "upload",
        width,
        height,
        makePublic,
      });

      saved.push({
        id: String(asset._id),
        filename: asset.filename,
        kind: asset.kind,
        role: asset.role,
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        width: asset.width,
        height: asset.height,
        publicUrl: asset.publicUrl,
        previewUrl: `/api/media/${asset._id}`,
      });
    } catch (error) {
      errors.push(`${file.name}: ${(error as Error).message}`);
    }
  }

  if (saved.length === 0) {
    return fail(`Ek pan file save na thai.\n${errors.join("\n")}`, 422);
  }

  return ok({ files: saved, errors }, 201);
});

/** Brand na upload karela media — Studio ma fari vaparva mate. */
export const GET = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const params = new URL(request.url).searchParams;
  const role = params.get("role");
  const limit = Math.min(Number(params.get("limit") ?? 60), 200);

  const filter: Record<string, unknown> = { brand: ctx.brandId };
  if (role) filter.role = role;

  const assets = await MediaAsset.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return ok(
    assets.map((asset) => ({
      id: String(asset._id),
      filename: asset.filename,
      kind: asset.kind,
      role: asset.role,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      publicUrl: asset.publicUrl,
      previewUrl: `/api/media/${asset._id}`,
      createdAt: asset.createdAt,
    })),
  );
});

export const DELETE = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return fail("Media id joiye", 400);

  const asset = await MediaAsset.findOneAndDelete({ _id: id, brand: ctx.brandId });
  if (!asset) return fail("Media madyu nahi", 404);

  return ok({ deleted: true });
});
