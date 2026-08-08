/**
 * TS version na AI providers ne SACHI request mokle che.
 *
 *   npx tsx scripts/ai-check.ts
 *
 * "Key set che" ane key KAAM kare che — e be alag vaat che. Aa script
 * lakhan ane vision banne tapase che, ane kayo provider chalyo e kahe che.
 */

import { existsSync } from "node:fs";
import path from "node:path";

const ENV = path.join(process.cwd(), ".env");
if (existsSync(ENV)) {
  try {
    process.loadEnvFile(ENV);
  } catch {
    // Junu Node — env jate set karvu padse.
  }
}

import { complete, providerStatus } from "../src/lib/ai/index";
import { analyzeProductImages } from "../src/lib/ai/vision";

async function main() {
  const configured = providerStatus().filter((p) => p.configured);
  console.log(
    "\nconfigured:",
    configured.map((p) => `${p.key}(${p.model})`).join(", ") || "ek pan nahi",
  );

  console.log("\n1. AI lakhan");
  try {
    const result = await complete<{ word: string }>({
      system: "Reply with JSON only.",
      prompt: 'Return exactly {"word":"ok"}',
      schema: {
        type: "object",
        properties: { word: { type: "string" } },
        required: ["word"],
      },
      maxTokens: 50,
    });
    console.log(`   ✓ ${result.provider} (${result.model}) →`, JSON.stringify(result.data));
  } catch (error) {
    console.log("   ✗", (error as Error).message.split("\n").slice(0, 5).join("\n     "));
  }

  console.log("\n2. AI — image samajvi");
  try {
    const sharp = (await import("sharp")).default;
    const image = await sharp({
      create: { width: 256, height: 256, channels: 3, background: { r: 30, g: 120, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const vision = await analyzeProductImages([{ data: image, mimeType: "image/jpeg" }], {
      hint: "solid blue colour swatch",
    });
    console.log(
      `   ✓ ${vision.provider} →`,
      vision.data.productName,
      "|",
      vision.data.colors.join(", "),
    );
  } catch (error) {
    console.log("   ✗", (error as Error).message.split("\n").slice(0, 5).join("\n     "));
  }

  console.log("");
}

main().catch((error) => {
  console.error("\n✗", (error as Error).message);
  process.exit(1);
});
