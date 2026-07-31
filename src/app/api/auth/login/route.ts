import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { signSession, setSessionCookie } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/api";
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

  user.lastLoginAt = new Date();
  await user.save();

  const token = await signSession({
    sub: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role as "admin" | "editor" | "viewer",
  });
  await setSessionCookie(token);

  await logActivity({
    action: "auth.login",
    message: `${user.email} login thayu`,
    actor: user.email,
  });

  return ok({ name: user.name, email: user.email, role: user.role });
});
