import { z } from "zod";
import { Automation } from "@/models/Automation";
import { computeNextRun } from "@/lib/automation-runner";
import { fail, handle, ok, requireAuth } from "@/lib/api";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  topic: z.string().min(3).optional(),
  tone: z.string().optional(),
  campaign: z.string().nullable().optional(),
  accounts: z.array(z.string()).optional(),
  frequency: z.enum(["hourly", "daily", "weekly"]).optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  autoPublish: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = handle(async (request, { params }) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  const automation = await Automation.findById(id);
  if (!automation) return fail("Automation madyu nahi", 404);

  Object.assign(automation, {
    ...body,
    campaign: body.campaign === null ? undefined : (body.campaign ?? automation.campaign),
  });

  // Schedule badlay to next run fari thi ganvo.
  if (
    body.frequency ||
    body.timeOfDay ||
    body.dayOfWeek !== undefined ||
    body.enabled !== undefined
  ) {
    automation.nextRunAt = automation.enabled
      ? computeNextRun(automation)
      : undefined;
  }

  await automation.save();
  return ok({ id: String(automation._id) });
});

export const DELETE = handle(async (_request, { params }) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const automation = await Automation.findByIdAndDelete(id);
  if (!automation) return fail("Automation madyu nahi", 404);
  return ok({ deleted: true });
});
