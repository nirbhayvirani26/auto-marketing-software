import { z } from "zod";
import { Campaign } from "@/models/Campaign";
import { handle, ok, requireAuth } from "@/lib/api";

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
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const campaigns = await Campaign.find()
    .populate("accounts", "displayName platform")
    .sort({ createdAt: -1 })
    .lean();
  return ok(campaigns);
});

export const POST = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const body = createSchema.parse(await request.json());
  const campaign = await Campaign.create({
    ...body,
    startDate: body.startDate ? new Date(body.startDate) : undefined,
    endDate: body.endDate ? new Date(body.endDate) : undefined,
    createdBy: auth.session.sub,
  });
  return ok({ id: String(campaign._id) }, 201);
});
