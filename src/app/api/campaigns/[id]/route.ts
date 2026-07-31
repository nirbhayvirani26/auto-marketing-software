import { z } from "zod";
import { Campaign } from "@/models/Campaign";
import { fail, handle, ok, requireAuth } from "@/lib/api";

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
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  const campaign = await Campaign.findByIdAndUpdate(
    id,
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
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const campaign = await Campaign.findByIdAndDelete(id);
  if (!campaign) return fail("Campaign madyu nahi", 404);
  return ok({ deleted: true });
});
