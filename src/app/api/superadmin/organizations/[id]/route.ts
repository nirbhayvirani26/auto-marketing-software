import { z } from "zod";
import { fail, handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { Organization } from "@/models/Organization";
import { Plan } from "@/models/Plan";
import { User } from "@/models/User";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  planKey: z.string().optional(),
  status: z
    .enum(["trial", "active", "past_due", "suspended", "cancelled"])
    .optional(),
  trialEndsAt: z.string().nullable().optional(),
  subscriptionEndsAt: z.string().nullable().optional(),
  notes: z.string().optional(),
  /** Per-module on/off — plan ne override kare. null = plan nu value vapro. */
  moduleOverrides: z.record(z.string(), z.boolean().nullable()).optional(),
  /** Per-limit override. null = plan nu value. */
  limitOverrides: z.record(z.string(), z.number().nullable()).optional(),
});

export const GET = handle(async (_request, { params }) => {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const [organization, users, plans] = await Promise.all([
    Organization.findById(id)
      .populate("plan")
      .populate("owner", "name email lastLoginAt")
      .lean(),
    User.find({ organization: id }).select("name email role lastLoginAt active").lean(),
    Plan.find({ active: true }).sort({ sortOrder: 1 }).lean(),
  ]);

  if (!organization) return fail("Organization madyu nahi", 404);
  return ok({ organization, users, plans });
});

export const PATCH = handle(async (request, { params }) => {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  const organization = await Organization.findById(id);
  if (!organization) return fail("Organization madyu nahi", 404);

  if (body.name) organization.name = body.name;
  if (body.status) organization.status = body.status;
  if (body.notes !== undefined) organization.notes = body.notes;

  if (body.planKey) {
    const plan = await Plan.findOne({ key: body.planKey, active: true });
    if (!plan) return fail(`Plan "${body.planKey}" madyo nahi`, 404);
    organization.plan = plan._id;
  }

  if (body.trialEndsAt !== undefined) {
    organization.trialEndsAt = body.trialEndsAt
      ? new Date(body.trialEndsAt)
      : undefined;
  }
  if (body.subscriptionEndsAt !== undefined) {
    organization.subscriptionEndsAt = body.subscriptionEndsAt
      ? new Date(body.subscriptionEndsAt)
      : undefined;
  }

  // null aave to override kadhi naakho (plan nu value pachu chalu thay).
  if (body.moduleOverrides) {
    const map = organization.moduleOverrides ?? new Map<string, boolean>();
    for (const [key, value] of Object.entries(body.moduleOverrides)) {
      if (value === null) map.delete(key);
      else map.set(key, value);
    }
    organization.moduleOverrides = map;
  }

  if (body.limitOverrides) {
    const map = organization.limitOverrides ?? new Map<string, number>();
    for (const [key, value] of Object.entries(body.limitOverrides)) {
      if (value === null) map.delete(key);
      else map.set(key, value);
    }
    organization.limitOverrides = map;
  }

  await organization.save();

  await logActivity({
    level: "info",
    action: "superadmin.org_updated",
    message: `Super admin e "${organization.name}" update karyu`,
    actor: guard.session.email,
    meta: body,
  });

  return ok({ id: String(organization._id) });
});
