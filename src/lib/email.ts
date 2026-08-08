import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transporter: Transporter | null = null;

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export type SendResult = {
  delivered: boolean;
  /** SMTP set na hoy tyare dev mode ma OTP ahiya pacho aave che. */
  devPreview?: string;
  error?: string;
};

/**
 * Email mokle. SMTP configure na hoy to fail nathi thatu — message terminal
 * ma print thay che ane `devPreview` ma pacho aave che, jethi setup vagar pan
 * register/login flow test kari shakay.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  if (!smtpConfigured()) {
    console.log(
      `\n[EMAIL — SMTP set nathi, etle fakt print karyu]\n  To: ${opts.to}\n  Subject: ${opts.subject}\n  ${opts.text}\n`,
    );
    return { delivered: false, devPreview: opts.text };
  }

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { delivered: true };
  } catch (error) {
    console.error("[EMAIL] send fail:", (error as Error).message);
    return { delivered: false, error: (error as Error).message };
  }
}

const BRAND_NAME = process.env.APP_NAME || "Auto Marketing";

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F6F7FB;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="100%" style="max-width:480px;background:#fff;border-radius:14px;padding:32px" cellpadding="0" cellspacing="0">
      <tr><td>
        <div style="font-weight:700;font-size:18px;color:#1A1D26;margin-bottom:24px">${BRAND_NAME}</div>
        <h1 style="font-size:20px;color:#1A1D26;margin:0 0 12px">${title}</h1>
        ${body}
        <p style="color:#8A90A0;font-size:12px;margin-top:28px">
          Aa email tame na mangavyu hoy to ignore karo.
        </p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function sendOtpEmail(opts: {
  to: string;
  code: string;
  purpose: "verify_email" | "login" | "reset_password";
}): Promise<SendResult> {
  const titles = {
    verify_email: "Tamaru email verify karo",
    login: "Login code",
    reset_password: "Password reset code",
  };
  const title = titles[opts.purpose];

  return sendEmail({
    to: opts.to,
    subject: `${opts.code} — ${title}`,
    text: `${title}\n\nTamaro code: ${opts.code}\n\nAa code 15 minute mate valid che.`,
    html: layout(
      title,
      `<p style="color:#5C6478;font-size:14px;margin:0 0 20px">Niche no code app ma nakho:</p>
       <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#5B5BD6;background:#F1F1FB;padding:16px;border-radius:10px;text-align:center">${opts.code}</div>
       <p style="color:#8A90A0;font-size:13px;margin-top:16px">Aa code 15 minute mate valid che.</p>`,
    ),
  });
}

export async function sendWelcomeEmail(opts: {
  to: string;
  name: string;
  organizationName: string;
}): Promise<SendResult> {
  return sendEmail({
    to: opts.to,
    subject: `${BRAND_NAME} ma swagat che!`,
    text: `Namaste ${opts.name},\n\n"${opts.organizationName}" taiyar thai gayu che. Login karo: ${env.appUrl}/login`,
    html: layout(
      `Swagat che, ${opts.name}!`,
      `<p style="color:#5C6478;font-size:14px">
        <strong>${opts.organizationName}</strong> taiyar thai gayu che. Have social
        accounts connect karo ane AI thi posts banavva shuru karo.
       </p>
       <a href="${env.appUrl}/admin" style="display:inline-block;margin-top:16px;background:#5B5BD6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Dashboard kholo</a>`,
    ),
  });
}
