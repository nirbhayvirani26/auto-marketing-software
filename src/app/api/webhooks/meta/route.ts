import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { handleIncomingComment, type IncomingComment } from "@/lib/comment-engine";
import { logActivity } from "@/models/ActivityLog";

export const dynamic = "force-dynamic";

/**
 * Meta (Facebook + Instagram) webhook.
 *
 * Setup — developers.facebook.com → app → Webhooks:
 *   Callback URL : https://<tamaru-domain>/api/webhooks/meta
 *   Verify Token : .env no META_WEBHOOK_VERIFY_TOKEN
 *   Subscribe    : Page → `feed`   |  Instagram → `comments`
 *
 * ⚠️ Meta ne PUBLIC https URL joiye che — localhost nahi chale.
 *    Local testing mate ngrok/cloudflared vapro.
 */

/** Step 1: Meta pehla GET thi URL verify kare che. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    return new NextResponse("META_WEBHOOK_VERIFY_TOKEN set nathi", {
      status: 503,
    });
  }

  if (mode === "subscribe" && token === expected) {
    // Meta ne challenge j pacho joiye — plain text ma.
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Verification fail", { status: 403 });
}

/** Meta na `x-hub-signature-256` header ne app secret thi verify kare. */
function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return false;
  if (!header?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: Record<string, unknown>;
    }>;
  }>;
};

/** Step 2: kharekhar na events. */
export async function POST(request: Request) {
  // Signature verify karva mate raw body joiye — parse karya pehla.
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Meta ne 20 second ma 200 joiye, nahi to retry kare che.
  // Etle process karine turant jawab aapiye.
  try {
    await connectDB();
    const comments = extractComments(body);

    for (const comment of comments) {
      await handleIncomingComment(comment);
    }

    if (comments.length === 0 && body.entry?.length) {
      await logActivity({
        action: "webhook.meta",
        message: `Meta webhook aavyu (${body.object}) — koi comment event na hato`,
        meta: body,
        actor: "meta",
      });
    }
  } catch (error) {
    await logActivity({
      level: "error",
      action: "webhook.meta",
      message: `Meta webhook process karta error: ${(error as Error).message}`,
      actor: "meta",
    });
  }

  // Meta ne haméshā 200 aapo — nahi to e vaar vaar retry karse.
  return NextResponse.json({ received: true });
}

/**
 * Meta na nested payload mathi comment events kadhe che.
 *
 * Facebook Page (`object: "page"`, field `feed`):
 *   value: { item: "comment", verb: "add", comment_id, post_id, message, from }
 *
 * Instagram (`object: "instagram"`, field `comments`):
 *   value: { id, text, media: { id }, from: { id, username } }
 */
function extractComments(body: MetaWebhookBody): IncomingComment[] {
  const found: IncomingComment[] = [];

  for (const entry of body.entry ?? []) {
    const accountRef = entry.id;
    if (!accountRef) continue;

    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      // ---- Facebook Page feed ----
      if (change.field === "feed") {
        if (value.item !== "comment") continue;
        // Edit/delete ne ignore karo — fakt nava comments.
        if (value.verb !== "add") continue;

        const from = value.from as
          | { id?: string; name?: string }
          | undefined;

        found.push({
          platform: "facebook",
          accountRef,
          commentId: String(value.comment_id ?? ""),
          postId: value.post_id ? String(value.post_id) : undefined,
          text: String(value.message ?? ""),
          fromUserId: from?.id,
          fromUsername: from?.name,
        });
      }

      // ---- Instagram comments ----
      if (change.field === "comments") {
        const from = value.from as
          | { id?: string; username?: string }
          | undefined;
        const media = value.media as { id?: string } | undefined;

        found.push({
          platform: "instagram",
          accountRef,
          commentId: String(value.id ?? ""),
          postId: media?.id,
          text: String(value.text ?? ""),
          fromUserId: from?.id,
          fromUsername: from?.username,
        });
      }
    }
  }

  // Potana j comments (brand e jate reply karyu hoy) skip karo — nahi to
  // rule potanа reply par fari trigger thay ane loop bane.
  return found.filter(
    (comment) => comment.commentId && comment.text.trim().length > 0,
  );
}
