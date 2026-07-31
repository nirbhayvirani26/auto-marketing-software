import { z } from "zod";
import { connectDB } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { User } from "@/models/User";
import { Organization } from "@/models/Organization";
import { verifyOtp, issueOtp } from "@/lib/otp";
import { setSessionCookie, signSession, type UserRole } from "@/lib/auth";
import { sendWelcomeEmail } from "@/lib/email";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
});

/** OTP verify — safal thay to email verified thay ane user login thai jaay. */
export const POST = handle(async (request) => {
  await connectDB();
  const { email, code } = verifySchema.parse(await request.json());

  const result = await verifyOtp(email, code, "verify_email");
  if (!result.ok) return fail(result.error ?? "Code verify na thayo", 400);

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return fail("User madyo nahi", 404);

  user.emailVerified = true;
  user.lastLoginAt = new Date();
  await user.save();

  const organization = user.organization
    ? await Organization.findById(user.organization)
    : null;

  if (organization) {
    await sendWelcomeEmail({
      to: user.email,
      name: user.name,
      organizationName: organization.name,
    });
  }

  await setSessionCookie(
    await signSession({
      sub: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      org: user.organization ? String(user.organization) : undefined,
    }),
  );

  await logActivity({
    level: "success",
    action: "auth.verified",
    message: `Email verify thayu: ${user.email}`,
    actor: user.email,
  });

  return ok({ verified: true, role: user.role });
});

const resendSchema = z.object({ email: z.string().email() });

/** Navo OTP mangavo. */
export const PUT = handle(async (request) => {
  await connectDB();
  const { email } = resendSchema.parse(await request.json());

  const user = await User.findOne({ email: email.toLowerCase() });
  // Email exist kare che ke nahi e batavvu nahi — enumeration rokva.
  if (!user || user.emailVerified) {
    return ok({ sent: true });
  }

  const otp = await issueOtp(email, "verify_email");
  return ok({ sent: otp.sent, devCode: otp.devCode });
});
