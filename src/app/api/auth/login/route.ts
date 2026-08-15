import bcrypt from "bcryptjs";
import { z } from "zod";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { User } from "@/models/User";
import { Organization } from "@/models/Organization";
import { signSession, setSessionCookie, type UserRole } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/api";
import { issueOtp } from "@/lib/otp";
import { logActivity } from "@/models/ActivityLog";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = handle(async (request) => {
  const { email, password } = schema.parse(await request.json());

  // On a brand-new copy of the project this is what creates the owner account,
  // so the credentials printed in the README actually work.
  await ensureBootstrapped();

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+passwordHash",
  );
  if (!user || !user.active) {
    return fail("Incorrect email or password", 401);
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) return fail("Incorrect email or password", 401);

  // Unverified email: send a fresh code and send them to the verify screen.
  if (!user.emailVerified) {
    const otp = await issueOtp(user.email, "verify_email");
    return fail("Your email address still needs to be verified", 403, {
      needsVerification: true,
      email: user.email,
      devCode: otp.devCode,
    });
  }

  // A suspended organization cannot sign in (the super admin always can).
  if (user.role !== "superadmin" && user.organization) {
    const organization = await Organization.findById(user.organization);
    if (!organization) {
      return fail("Your organization could not be found — please contact support", 403);
    }
    if (["suspended", "cancelled"].includes(organization.status)) {
      return fail(
        `This account is ${organization.status}. Please contact support.`,
        403,
      );
    }
  }

  user.lastLoginAt = new Date();
  await user.save();

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
    action: "auth.login",
    message: `${user.email} signed in`,
    actor: user.email,
  });

  return ok({
    name: user.name,
    email: user.email,
    role: user.role,
    isSuperAdmin: user.role === "superadmin",
  });
});
