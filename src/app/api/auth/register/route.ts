import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { User } from "@/models/User";
import { Organization } from "@/models/Organization";
import { Plan } from "@/models/Plan";
import { Brand, slugify } from "@/models/Brand";
import { issueOtp } from "@/lib/otp";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8, "Password ochha ma ochho 8 character no hovo joiye"),
  organizationName: z.string().min(2).max(80),
  planKey: z.string().optional(),
});

/**
 * Navo customer register kare:
 *   User (owner) + Organization + pehlu Brand ek saathe bane che.
 *   Email verify karva OTP mokalay che — verify na thay tyā sudhi login band.
 */
export const POST = handle(async (request) => {
  await connectDB();
  const body = schema.parse(await request.json());
  const email = body.email.toLowerCase().trim();

  if (await User.exists({ email })) {
    return fail("That email is already registered — sign in instead", 409);
  }

  // Plan nakki karo (default: starter, ke pehlo visible plan)
  const plan =
    (body.planKey && (await Plan.findOne({ key: body.planKey, active: true }))) ||
    (await Plan.findOne({ key: "starter", active: true })) ||
    (await Plan.findOne({ active: true }).sort({ sortOrder: 1 }));

  if (!plan) {
    return fail("No plans are configured — please contact the administrator", 503);
  }

  const user = await User.create({
    name: body.name.trim(),
    email,
    passwordHash: await bcrypt.hash(body.password, 12),
    role: "owner",
    emailVerified: false,
    active: true,
  });

  // Organization slug unique hovo joiye
  const base = slugify(body.organizationName) || "org";
  let slug = base;
  for (let i = 2; await Organization.exists({ slug }); i += 1) {
    slug = `${base}-${i}`;
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 14);

  const organization = await Organization.create({
    name: body.organizationName.trim(),
    slug,
    owner: user._id,
    plan: plan._id,
    status: "trial",
    trialEndsAt,
  });

  user.organization = organization._id;
  user.organizations = [organization._id];
  await user.save();

  // Pehlu brand — user turant kaam shuru kari shake.
  await Brand.create({
    organization: organization._id,
    name: body.organizationName.trim(),
    slug: "default",
    brandVoice: "friendly, professional",
    createdBy: user._id,
  });

  const otp = await issueOtp(email, "verify_email");

  await logActivity({
    level: "success",
    action: "auth.register",
    message: `Navu registration: ${email} — "${organization.name}" (${plan.name} plan)`,
    actor: email,
  });

  return ok(
    {
      email,
      organizationName: organization.name,
      plan: plan.name,
      trialEndsAt,
      emailSent: otp.sent,
      // SMTP set na hoy to dev ma code ahiya dekhaay che.
      devCode: otp.devCode,
    },
    201,
  );
});
