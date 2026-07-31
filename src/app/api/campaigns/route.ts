import { z } from "zod";
import { Campaign } from "@/models/Campaign";
import { handle, ok, requireBrand } from "@/lib/api";

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  brandVoice: z.string().optional(),
  targetAudience: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
  callToAction: z.string().optional(),
  accounts: z.array(z.string()).optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const GET = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const campaigns = await Campaign.find({ brand: ctx.brandId })
    .populate("accounts", "displayName platform")
    .sort({ createdAt: -1 })
    .lean();
  return ok(campaigns);
});

export const POST = handle(async (request) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const body = createSchema.parse(await request.json());
  const campaign = await Campaign.create({
    ...body,
    brand: ctx.brandId,
    startDate: body.startDate ? new Date(body.startDate) : undefined,
    endDate: body.endDate ? new Date(body.endDate) : undefined,
    createdBy: ctx.session.sub,
  });
  return ok({ id: String(campaign._id) }, 201);
});
