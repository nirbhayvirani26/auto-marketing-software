import { z } from "zod";
import { Automation } from "@/models/Automation";
import { computeNextRun } from "@/lib/automation-runner";
import { handle, ok, requireBrand } from "@/lib/api";

const createSchema = z.object({
  name: z.string().min(1),
  topic: z.string().min(3),
  tone: z.string().optional(),
  campaign: z.string().optional(),
  accounts: z.array(z.string()).optional(),
  frequency: z.enum(["hourly", "daily", "weekly"]).default("daily"),
  timeOfDay: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Format HH:MM hovu joiye")
    .default("09:30"),
  dayOfWeek: z.number().int().min(0).max(6).default(1),
  autoPublish: z.boolean().default(false),
  enabled: z.boolean().default(true),

  /**
   * reel = dar vakhate ek product ni image lai ne AKHI reel banave ane
   * Instagram + Facebook banne par muki de. "Set karo ane bhuli jao."
   */
  mode: z.enum(["post", "reel"]).default("post"),
  reelSource: z.enum(["library", "fixed"]).default("library"),
  reelImages: z.array(z.string()).optional(),
  reelProductCount: z.number().int().min(1).max(10).default(1),
  reelDuration: z.number().int().min(15).max(90).default(40),
  reelLanguage: z.enum(["en", "hi", "gu", "hinglish"]).default("en"),
  reelAvatar: z.string().optional(),
  reelVoiceover: z.boolean().default(false),
});

export const GET = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const automations = await Automation.find({ brand: ctx.brandId })
    .populate("campaign", "name")
    .populate("accounts", "displayName platform")
    .sort({ createdAt: -1 })
    .lean();
  return ok(automations);
});

export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const body = createSchema.parse(await request.json());
  const automation = await Automation.create({
    ...body,
    brand: ctx.brandId,
    campaign: body.campaign || undefined,
    reelAvatar: body.reelAvatar || undefined,
    reelImages: body.reelImages?.length ? body.reelImages : undefined,
    nextRunAt: computeNextRun(body),
    createdBy: ctx.session.sub,
  });
  return ok({ id: String(automation._id) }, 201);
});
