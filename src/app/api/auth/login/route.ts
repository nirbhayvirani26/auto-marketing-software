import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDB } from "@/lib/db";
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
  await connectDB();

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+passwordHash",
  );
  if (!user || !user.active) {
    return fail("Email ke password khoto che", 401);
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) return fail("Email ke password khoto che", 401);

  // Email verify na thayu hoy to navo OTP moklo ane verify screen par moklo.
  if (!user.emailVerified) {
    const otp = await issueOtp(user.email, "verify_email");
    return fail("Email verify baaki che", 403, {
      needsVerification: true,
      email: user.email,
      devCode: otp.devCode,
    });
  }

  // Organization suspend thayelu hoy to andar na aavva do (superadmin sivay).
  if (user.role !== "superadmin" && user.organization) {
    const organization = await Organization.findById(user.organization);
    if (!organization) {
      return fail("Tamaru organization madyu nahi — support no sampark karo", 403);
    }
    if (["suspended", "cancelled"].includes(organization.status)) {
      return fail(
        `Tamaru account ${organization.status} che. Support no sampark karo.`,
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
    message: `${user.email} login thayu`,
    actor: user.email,
  });

  return ok({
    name: user.name,
    email: user.email,
    role: user.role,
    isSuperAdmin: user.role === "superadmin",
  });
});
