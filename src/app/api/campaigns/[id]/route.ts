import { z } from "zod";
import { Campaign } from "@/models/Campaign";
import { fail, handle, ok, requireBrand } from "@/lib/api";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  brandVoice: z.string().optional(),
  targetAudience: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
  callToAction: z.string().optional(),
  accounts: z.array(z.string()).optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const PATCH = handle(async (request, { params }) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  const campaign = await Campaign.findOneAndUpdate(
    { _id: id, brand: ctx.brandId },
    {
      ...body,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
    },
    { new: true },
  );
  if (!campaign) return fail("Campaign madyu nahi", 404);
  return ok({ id: String(campaign._id) });
});

export const DELETE = handle(async (_request, { params }) => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const { id } = await params;
  const campaign = await Campaign.findOneAndDelete({
    _id: id,
    brand: ctx.brandId,
  });
  if (!campaign) return fail("Campaign madyu nahi", 404);
  return ok({ deleted: true });
});
