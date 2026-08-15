import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { fail, handle, ok } from "@/lib/api";
import { Post } from "@/models/Post";
import { Automation } from "@/models/Automation";
import { publishPost } from "@/lib/publisher";
import { runAutomation } from "@/lib/automation-runner";
import { logActivity } from "@/models/ActivityLog";
import { reapStuckJobs } from "@/lib/reels/runner";

export const dynamic = "force-dynamic";

/**
 * Scheduler tick. Be kaam kare che:
 *  1. Je post nu `scheduledAt` vitya gayu hoy ene publish kare
 *  2. Je automation nu `nextRunAt` vitya gayu hoy ene chalave
 *
 * Aane har minute call karo — n8n Schedule Trigger thi, Windows Task
 * Scheduler thi, ke `curl` thi:
 *   curl -X POST http://localhost:3000/api/cron/dispatch -H "x-cron-secret: <CRON_SECRET>"
 */
async function dispatch(request: Request) {
  const secret = env.cronSecret;
  if (!secret) return fail("CRON_SECRET is not set in .env", 500);
  if (request.headers.get("x-cron-secret") !== secret) {
    return fail("Invalid cron secret", 401);
  }

  await connectDB();
  const now = new Date();

  // --- 1. Due posts ---
  const duePosts = await Post.find({
    status: "scheduled",
    scheduledAt: { $lte: now },
  })
    .select("_id")
    .limit(25)
    .lean();

  const postResults = [];
  for (const post of duePosts) {
    const result = await publishPost(String(post._id));
    postResults.push({ postId: String(post._id), ...result });
  }

  // --- 2. Due automations ---
  const dueAutomations = await Automation.find({
    enabled: true,
    nextRunAt: { $lte: now },
  })
    .select("_id")
    .limit(10)
    .lean();

  const automationResults = [];
  for (const automation of dueAutomations) {
    automationResults.push(await runAutomation(String(automation._id)));
  }

  // --- 3. Atkela reel jobs ---
  // Server restart thay to "running" ma atkela job kaayam tya rahi jaay che.
  // Aa ene "failed" kari de che ane queue ma padela job chalu kare che.
  const reapedReels = await reapStuckJobs().catch(() => 0);

  if (duePosts.length || dueAutomations.length || reapedReels) {
    await logActivity({
      action: "cron.dispatch",
      message: `Cron tick — ${duePosts.length} post, ${dueAutomations.length} automation, ${reapedReels} atkela reel`,
      meta: { postResults, automationResults },
    });
  }

  return ok({
    ranAt: now.toISOString(),
    postsProcessed: postResults.length,
    automationsProcessed: automationResults.length,
    reelsReaped: reapedReels,
    postResults,
    automationResults,
  });
}

export const POST = handle(dispatch);
export const GET = handle(dispatch);
