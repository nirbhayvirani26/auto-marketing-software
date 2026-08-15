import { readFile } from "node:fs/promises";
import { z } from "zod";

import { fail, handle, ok, requireBrand } from "@/lib/api";
import { Avatar } from "@/models/Avatar";
import { MediaAsset } from "@/models/MediaAsset";
import { logActivity } from "@/models/ActivityLog";
import { ensureLocalPath, saveMedia } from "@/lib/media/store";
import {
  AVATAR_VIEWS,
  avatarView,
  generateAvatarView,
} from "@/lib/avatar/generate-views";

export const dynamic = "force-dynamic";
// Generating six views is several image calls back to back.
export const maxDuration = 300;

const bodySchema = z.object({
  /** Which views to make. Empty or missing means the standard set. */
  views: z.array(z.string()).optional(),
  /** Extra direction, e.g. "wearing a navy saree, outdoors". */
  direction: z.string().max(400).optional(),
  /** Replace an existing view of the same kind rather than adding another. */
  replace: z.boolean().optional(),
});

/** The catalogue of views that can be generated. */
export const GET = handle(async (_request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const avatar = await Avatar.findOne({ _id: id, brand: auth.brandId }).lean();
  if (!avatar) return fail("Avatar not found", 404);

  const media = await MediaAsset.find({
    _id: { $in: (avatar.generatedViews ?? []).map((view) => view.media) },
  }).lean();

  const byId = new Map(media.map((asset) => [String(asset._id), asset]));

  return ok({
    available: AVATAR_VIEWS.map((view) => ({
      key: view.key,
      label: view.label,
      purpose: view.purpose,
    })),
    generated: (avatar.generatedViews ?? []).map((view) => {
      const asset = byId.get(String(view.media));
      return {
        key: view.key,
        label: view.label,
        purpose: view.purpose,
        provider: view.provider,
        createdAt: view.createdAt,
        mediaId: String(view.media),
        url: asset?.publicUrl ?? `/api/media/${view.media}`,
      };
    }),
  });
});

/**
 * Generates avatar views from the reference photos.
 *
 * Runs inline — the seller pressed a button and is waiting — but each view is
 * saved as it completes, so a partial failure still leaves usable results
 * rather than nothing.
 */
export const POST = handle(async (request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const body = bodySchema.parse(await request.json().catch(() => ({})));

  const avatar = await Avatar.findOne({ _id: id, brand: auth.brandId });
  if (!avatar) return fail("Avatar not found", 404);

  if (!avatar.referencePhotos?.length) {
    return fail(
      "This avatar has no reference photos. Add at least one clear photo first.",
      409,
    );
  }

  /* ---- Load the reference photos ---- */
  const referenceAssets = await MediaAsset.find({
    _id: { $in: avatar.referencePhotos },
  });
  if (referenceAssets.length === 0) {
    return fail("The reference photos for this avatar could not be found", 409);
  }

  const references = await Promise.all(
    referenceAssets.map(async (asset) => readFile(await ensureLocalPath(asset))),
  );

  /* ---- Which views ---- */
  const wanted = body.views?.length
    ? body.views.map(avatarView).filter((view) => view !== undefined)
    : AVATAR_VIEWS;

  if (wanted.length === 0) return fail("No valid view was requested", 422);

  const created: Array<{ key: string; label: string; url: string; provider: string }> = [];
  const failed: Array<{ key: string; label: string; reason: string }> = [];

  for (const view of wanted) {
    try {
      const generated = await generateAvatarView(view, references, body.direction);

      const asset = await saveMedia({
        data: generated.data,
        filename: `avatar-${avatar.name}-${view.key}.jpg`,
        mimeType: generated.mimeType,
        role: "avatar",
        brand: auth.brandId,
        createdBy: auth.session.sub,
        provider: generated.provider,
        prompt: generated.prompt,
        makePublic: false,
      });

      const entry = {
        key: view.key,
        label: view.label,
        purpose: view.purpose,
        media: asset._id,
        provider: generated.provider,
        createdAt: new Date(),
      };

      avatar.generatedViews = [
        ...(avatar.generatedViews ?? []).filter(
          (existing) => body.replace === false || existing.key !== view.key,
        ),
        entry,
      ];
      await avatar.save();

      created.push({
        key: view.key,
        label: view.label,
        url: `/api/media/${asset._id}`,
        provider: generated.provider,
      });
    } catch (error) {
      failed.push({
        key: view.key,
        label: view.label,
        reason: (error as Error).message.slice(0, 200),
      });
    }
  }

  await logActivity({
    level: created.length > 0 ? "success" : "error",
    action: "avatar.views_generated",
    message: `${avatar.name} — ${created.length} views generated, ${failed.length} failed`,
    actor: auth.session.email,
  });

  if (created.length === 0) {
    return fail(
      "No views could be generated. This needs an image model that reads reference photos — set GEMINI_API_KEY for Nano Banana, or OPENAI_API_KEY.",
      502,
      { failed },
    );
  }

  return ok({ created, failed });
});

/** Removes one generated view. */
export const DELETE = handle(async (request, ctx) => {
  const auth = await requireBrand();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return fail("Which view should be removed?", 422);

  const avatar = await Avatar.findOne({ _id: id, brand: auth.brandId });
  if (!avatar) return fail("Avatar not found", 404);

  avatar.generatedViews = (avatar.generatedViews ?? []).filter(
    (view) => view.key !== key,
  );
  await avatar.save();

  return ok({ removed: key });
});
