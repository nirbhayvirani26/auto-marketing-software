import { z } from "zod";
import { fail, handle, ok, requireBrand } from "@/lib/api";
import { Avatar } from "@/models/Avatar";
import { MediaAsset } from "@/models/MediaAsset";
import { askVision } from "@/lib/ai/vision";
import { ensureLocalPath } from "@/lib/media/store";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export const GET = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const avatars = await Avatar.find({ brand: ctx.brandId, active: true })
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();

  return ok(
    avatars.map((avatar) => ({
      ...avatar,
      _id: String(avatar._id),
      photoUrls: (avatar.referencePhotos ?? []).map((id) => `/api/media/${id}`),
      primaryPhotoUrl: avatar.primaryPhoto ? `/api/media/${avatar.primaryPhoto}` : null,
      generatedViews: (avatar.generatedViews ?? []).map((view) => ({
        key: view.key,
        label: view.label,
        url: `/api/media/${view.media}`,
      })),
    })),
  );
});

const createSchema = z.object({
  name: z.string().min(1).max(60),
  /** Upload karela photo na MediaAsset id — 1 thi 5. */
  photoIds: z.array(z.string()).min(1).max(5),
  description: z.string().max(600).optional(),
  gender: z.enum(["female", "male", "non-binary", "unspecified"]).optional(),
  ageRange: z.string().max(20).optional(),
  skinTone: z.string().max(60).optional(),
  hair: z.string().max(80).optional(),
  bodyType: z.string().max(60).optional(),
  persona: z.string().max(200).optional(),
  language: z.enum(["en", "hi", "gu", "hinglish"]).optional(),
  wardrobeNotes: z.string().max(400).optional(),
  settingNotes: z.string().max(400).optional(),
  isDefault: z.boolean().optional(),
  /** true = photo joine AI j varnan bhari de. */
  autoDescribe: z.boolean().optional(),
});

const DESCRIBE_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string", description: "Two sentences describing this person's appearance for an image model: face shape, hair, skin tone, build, general style. Neutral and factual." },
    gender: { type: "string", enum: ["female", "male", "non-binary", "unspecified"] },
    ageRange: { type: "string", description: "e.g. 24-30" },
    skinTone: { type: "string" },
    hair: { type: "string", description: "Length, texture, colour." },
    bodyType: { type: "string" },
  },
  required: ["description", "gender", "ageRange", "skinTone", "hair", "bodyType"],
};

/**
 * Avatar banavo.
 *
 * `autoDescribe` chalu hoy to photo joine AI j badhu bhari de che — user e
 * fakt naam ane photo aapvana. Aa varnan pachi DAREAK reel ni image
 * generation ma jaay che, etle chehro badhi reels ma sarkho rahe che.
 */
export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const body = createSchema.parse(await request.json());

  const photos = await MediaAsset.find({
    _id: { $in: body.photoIds },
    brand: ctx.brandId,
    kind: "image",
  });
  if (photos.length === 0) {
    return fail("An avatar needs at least one photo", 422);
  }

  let described: Partial<z.infer<typeof createSchema>> = {};
  let describeError: string | undefined;

  if (body.autoDescribe !== false && !body.description) {
    try {
      const buffers = await Promise.all(
        photos.slice(0, 3).map(async (photo) => ({
          data: await readFile(await ensureLocalPath(photo)),
          mimeType: photo.mimeType,
        })),
      );

      const { data } = await askVision<Record<string, string>>(buffers, {
        system:
          "You describe a person's appearance so an image model can recreate them consistently. Be factual and neutral. Never guess a name, ethnicity label, or anything not visible.",
        prompt:
          "Describe the person in these photos so they can be redrawn consistently across many images.",
        schema: DESCRIBE_SCHEMA,
        maxTokens: 1200,
      });

      described = {
        description: data.description,
        gender: data.gender as never,
        ageRange: data.ageRange,
        skinTone: data.skinTone,
        hair: data.hair,
        bodyType: data.bodyType,
      };
    } catch (error) {
      describeError = (error as Error).message;
    }
  }

  // Ek brand ma ek j default avatar.
  if (body.isDefault) {
    await Avatar.updateMany({ brand: ctx.brandId }, { isDefault: false });
  }

  const existingCount = await Avatar.countDocuments({ brand: ctx.brandId });

  const avatar = await Avatar.create({
    brand: ctx.brandId,
    name: body.name,
    description: body.description ?? described.description,
    referencePhotos: photos.map((p) => p._id),
    primaryPhoto: photos[0]._id,
    gender: body.gender ?? described.gender ?? "unspecified",
    ageRange: body.ageRange ?? described.ageRange,
    skinTone: body.skinTone ?? described.skinTone,
    hair: body.hair ?? described.hair,
    bodyType: body.bodyType ?? described.bodyType,
    persona: body.persona,
    language: body.language ?? "en",
    wardrobeNotes: body.wardrobeNotes,
    settingNotes: body.settingNotes,
    // Pehlo avatar apoaap default bane che.
    isDefault: body.isDefault ?? existingCount === 0,
    createdBy: ctx.session.sub,
  });

  return ok({ avatar, describeError }, 201);
});

const updateSchema = createSchema.partial().extend({ id: z.string() });

export const PATCH = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const body = updateSchema.parse(await request.json());
  const { id, photoIds, autoDescribe, ...patch } = body;
  void autoDescribe;

  if (patch.isDefault) {
    await Avatar.updateMany({ brand: ctx.brandId }, { isDefault: false });
  }

  const update: Record<string, unknown> = { ...patch };
  if (photoIds?.length) {
    const photos = await MediaAsset.find({
      _id: { $in: photoIds },
      brand: ctx.brandId,
      kind: "image",
    });
    if (photos.length) {
      update.referencePhotos = photos.map((p) => p._id);
      update.primaryPhoto = photos[0]._id;
    }
  }

  const avatar = await Avatar.findOneAndUpdate(
    { _id: id, brand: ctx.brandId },
    update,
    { new: true },
  );
  if (!avatar) return fail("Avatar not found", 404);

  return ok(avatar);
});

export const DELETE = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return fail("An avatar id is required", 400);

  const avatar = await Avatar.findOneAndUpdate(
    { _id: id, brand: ctx.brandId },
    { active: false, isDefault: false },
    { new: true },
  );
  if (!avatar) return fail("Avatar not found", 404);

  return ok({ deleted: true });
});
