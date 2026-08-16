import { z } from "zod";

import { handle, ok, requireBrand } from "@/lib/api";
import { MediaAsset } from "@/models/MediaAsset";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  /** "image" | "video" — omit for both. */
  kind: z.enum(["image", "video", "audio", "other"]).optional(),
  /** Narrow to particular roles, comma separated. */
  roles: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

/**
 * The brand's media library.
 *
 * Backs the reference pickers on the Create page: every product photo you have
 * uploaded, every image the AI has made, and every reel you have rendered or
 * supplied as a style reference. Reusing what is already here beats
 * re-uploading the same photograph for the fifth time.
 */
export const GET = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = querySchema.parse(params);

  const filter: Record<string, unknown> = { brand: ctx.brandId };
  if (query.kind) filter.kind = query.kind;

  if (query.roles) {
    const roles = query.roles.split(",").map((role) => role.trim()).filter(Boolean);
    if (roles.length) filter.role = { $in: roles };
  }

  const assets = await MediaAsset.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit ?? 60)
    .lean();

  return ok(
    assets.map((asset) => ({
      id: String(asset._id),
      kind: asset.kind,
      role: asset.role,
      filename: asset.filename,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      provider: asset.provider,
      createdAt: asset.createdAt,
      url: `/api/media/${asset._id}`,
      // A video needs a still to show in a grid; its own first frame is not
      // available here, so the caller falls back to an icon.
      previewUrl: asset.kind === "image" ? `/api/media/${asset._id}` : null,
    })),
  );
});
