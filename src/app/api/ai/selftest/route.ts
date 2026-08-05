import { handle, ok, requireBrand } from "@/lib/api";
import { generatePosts, generateCommentReply, providerStatus } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ToolResult = {
  tool: string;
  description: string;
  ok: boolean;
  ms: number;
  sample?: unknown;
  error?: string;
};

async function run(
  tool: string,
  description: string,
  fn: () => Promise<unknown>,
): Promise<ToolResult> {
  const started = Date.now();
  try {
    const sample = await fn();
    return { tool, description, ok: true, ms: Date.now() - started, sample };
  } catch (error) {
    return {
      tool,
      description,
      ok: false,
      ms: Date.now() - started,
      error: (error as Error).message,
    };
  }
}

/**
 * Badha AI tools ne ek saathe test kare ane sacho jawab pacho aape.
 * Settings page nu "AI tools test karo" button aane call kare che.
 *
 * Aa kharekhar Anthropic API ne call kare che — etle thoda tokens vaparashe.
 */
export const POST = handle(async () => {
  const ctx = await requireBrand();
  if ("response" in ctx) return ctx.response;

  const results: ToolResult[] = [];

  // 1. Facebook post generation
  results.push(
    await run(
      "generatePosts (facebook)",
      "Facebook mate caption + hashtags",
      async () => {
        const [post] = await generatePosts({
          topic: "Diwali special — 20% off on home cleaning",
          platform: "facebook",
          tone: "warm",
          variants: 1,
        });
        return {
          caption: post.caption.slice(0, 160),
          hashtagCount: post.hashtags.length,
          hasImagePrompt: Boolean(post.imagePrompt),
        };
      },
    ),
  );

  // 2. Instagram post generation
  results.push(
    await run(
      "generatePosts (instagram)",
      "Instagram mate hook-first caption",
      async () => {
        const [post] = await generatePosts({
          topic: "Diwali special — 20% off on home cleaning",
          platform: "instagram",
          tone: "warm",
          variants: 1,
        });
        return {
          caption: post.caption.slice(0, 160),
          hashtagCount: post.hashtags.length,
        };
      },
    ),
  );

  // 3. Multi-variant
  results.push(
    await run(
      "generatePosts (3 variants)",
      "Ek j topic par 3 alag angle",
      async () => {
        const posts = await generatePosts({
          topic: "New winter menu launch at our cafe",
          platform: "facebook",
          variants: 3,
        });
        return {
          count: posts.length,
          allDifferent:
            new Set(posts.map((p) => p.caption)).size === posts.length,
          firstLines: posts.map((p) => p.caption.split("\n")[0].slice(0, 60)),
        };
      },
    ),
  );

  // 4. Comment reply — sawal
  results.push(
    await run(
      "generateCommentReply (question)",
      "Comment no public reply + DM",
      async () => {
        const reply = await generateCommentReply({
          comment: "kitla rupiya thashe? DM me price please",
          username: "ravi_patel",
          platform: "instagram",
          instruction: "Price DM ma moklo ane website par lai jao",
          needsPublicReply: true,
          needsDm: true,
        });
        return {
          publicReply: reply.publicReply.slice(0, 120),
          dm: reply.dm.slice(0, 120),
        };
      },
    ),
  );

  // 5. Comment reply — complaint (tone check)
  results.push(
    await run(
      "generateCommentReply (complaint)",
      "Naraz customer ne jawab",
      async () => {
        const reply = await generateCommentReply({
          comment: "Worst service. 3 days and still no response!",
          username: "unhappy_user",
          platform: "facebook",
          needsPublicReply: true,
          needsDm: true,
        });
        return {
          publicReply: reply.publicReply.slice(0, 120),
          dm: reply.dm.slice(0, 120),
        };
      },
    ),
  );

  const passed = results.filter((r) => r.ok).length;

  // Kharekhar kayo provider vaparayo — chain ma pehlo active hoy e.
  const active = providerStatus().find((p) => p.active);

  return ok({
    provider: active?.label ?? "koi nahi",
    model: active?.model ?? "—",
    free: active?.free ?? false,
    total: results.length,
    passed,
    failed: results.length - passed,
    totalMs: results.reduce((sum, r) => sum + r.ms, 0),
    results,
  });
});
