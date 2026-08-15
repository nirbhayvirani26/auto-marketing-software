import { z } from "zod";
import bcrypt from "bcryptjs";
import { fail, handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { User } from "@/models/User";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

/** Badha users — kayo user kai organization ma che e saathe. */
export const GET = handle(async (request) => {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const search = new URL(request.url).searchParams.get("q");
  const filter = search
    ? {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }
    : {};

  const users = await User.find(filter)
    .populate("organization", "name slug status")
    .select("name email role organization active emailVerified lastLoginAt createdAt")
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  return ok(users);
});

const patchSchema = z.object({
  userId: z.string(),
  role: z.enum(["superadmin", "owner", "admin", "member"]).optional(),
  active: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  /** Super admin user no password reset kari shake (support mate). */
  newPassword: z.string().min(8).optional(),
});

export const PATCH = handle(async (request) => {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const body = patchSchema.parse(await request.json());

  const user = await User.findById(body.userId);
  if (!user) return fail("User not found", 404);

  // Potej ne demote na kari shakay — nahi to platform lock thai jay.
  if (
    String(user._id) === guard.session.sub &&
    body.role &&
    body.role !== "superadmin"
  ) {
    return fail("You cannot remove your own super admin role", 409);
  }

  if (body.role) user.role = body.role;
  if (body.active !== undefined) user.active = body.active;
  if (body.emailVerified !== undefined) user.emailVerified = body.emailVerified;
  if (body.newPassword) {
    user.passwordHash = await bcrypt.hash(body.newPassword, 12);
  }
  await user.save();

  await logActivity({
    level: "warning",
    action: "superadmin.user_updated",
    message: `Super admin e ${user.email} update karyu`,
    actor: guard.session.email,
    meta: { ...body, newPassword: body.newPassword ? "(badlayo)" : undefined },
  });

  return ok({ id: String(user._id) });
});
