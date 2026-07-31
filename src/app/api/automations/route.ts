import { z } from "zod";
import { Automation } from "@/models/Automation";
import { computeNextRun } from "@/lib/automation-runner";
import { handle, ok, requireAuth } from "@/lib/api";

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
});

export const GET = handle(async () => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const automations = await Automation.find()
    .populate("campaign", "name")
    .populate("accounts", "displayName platform")
    .sort({ createdAt: -1 })
    .lean();
  return ok(automations);
});

export const POST = handle(async (request) => {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  const body = createSchema.parse(await request.json());
  const automation = await Automation.create({
    ...body,
    campaign: body.campaign || undefined,
    nextRunAt: computeNextRun(body),
    createdBy: auth.session.sub,
  });
  return ok({ id: String(automation._id) }, 201);
});
