import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { Otp } from "@/models/User";
import { sendOtpEmail } from "./email";

export type OtpPurpose = "verify_email" | "login" | "reset_password";

const MAX_ATTEMPTS = 5;

/**
 * Navo 6-digit OTP banave, hash karine save kare, ane email mokle.
 * SMTP set na hoy to `devCode` pacho aave che (fakt development ma).
 */
export async function issueOtp(
  email: string,
  purpose: OtpPurpose,
): Promise<{ sent: boolean; devCode?: string; error?: string }> {
  const normalised = email.toLowerCase().trim();

  // Juna un-consumed codes rad karo — ek j vakhte ek j code chale.
  await Otp.deleteMany({ email: normalised, purpose, consumedAt: null });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await Otp.create({
    email: normalised,
    codeHash: await bcrypt.hash(code, 10),
    purpose,
  });

  const result = await sendOtpEmail({ to: normalised, code, purpose });

  return {
    sent: result.delivered,
    // Production ma kadi code pacho na aapo.
    devCode:
      !result.delivered && process.env.NODE_ENV !== "production"
        ? code
        : undefined,
    error: result.error,
  };
}

/**
 * Code verify kare. Safal thay to code consume thai jaay che (fari na chale).
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<{ ok: boolean; error?: string }> {
  const normalised = email.toLowerCase().trim();

  const record = await Otp.findOne({
    email: normalised,
    purpose,
    consumedAt: null,
  }).sort({ createdAt: -1 });

  if (!record) {
    return { ok: false, error: "Code madyo nahi ke expire thai gayo — navo mangavo" };
  }

  if ((record.attempts ?? 0) >= MAX_ATTEMPTS) {
    await record.deleteOne();
    return { ok: false, error: "Bahu vaar khoto code — navo code mangavo" };
  }

  const matches = await bcrypt.compare(code.trim(), record.codeHash);
  if (!matches) {
    record.attempts = (record.attempts ?? 0) + 1;
    await record.save();
    return {
      ok: false,
      error: `Khoto code — ${MAX_ATTEMPTS - (record.attempts ?? 0)} prayatno baaki`,
    };
  }

  record.consumedAt = new Date();
  await record.save();
  return { ok: true };
}
