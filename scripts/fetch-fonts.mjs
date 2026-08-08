#!/usr/bin/env node
/**
 * Reel na text mate free fonts download kare che.
 *
 *   npm run fonts
 *
 * Aa farjiyat NATHI — system na fonts thi pan kaam chale che. Pan aa fonts
 * reel ma dekhaava ma ghana saara lage che, ane Hindi/Gujarati mate khatri
 * thai jaay che ke akshar chorasa (□□□) nahi dekhay.
 *
 * Badha fonts Open Font License na che — commercial vaparash free che.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "assets", "fonts");

const FONTS = [
  {
    name: "Poppins-Bold.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf",
    why: "Reel na headline mate — English",
  },
  {
    name: "Poppins-SemiBold.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-SemiBold.ttf",
    why: "Nana text mate",
  },
  {
    name: "Anton-Regular.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
    why: "Moto bold hook — dhyan khenche che",
  },
  {
    name: "NotoSansDevanagari-Bold.ttf",
    url: "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Bold.ttf",
    why: "Hindi text",
  },
  {
    name: "NotoSansGujarati-Bold.ttf",
    url: "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSansGujarati/hinted/ttf/NotoSansGujarati-Bold.ttf",
    why: "Gujarati text",
  },
];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function download(font) {
  const target = path.join(OUT_DIR, font.name);

  if (await exists(target)) {
    console.log(`  ✓ ${font.name} (pehle thi che)`);
    return true;
  }

  try {
    const response = await fetch(font.url, {
      signal: AbortSignal.timeout(60_000),
      headers: { "user-agent": "auto-marketing-software" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 10_000) throw new Error("file bahu nani — kharab lage che");

    await writeFile(target, data);
    console.log(`  ✓ ${font.name}  (${Math.round(data.length / 1024)} KB) — ${font.why}`);
    return true;
  } catch (error) {
    console.warn(`  ✗ ${font.name} — ${error.message}`);
    return false;
  }
}

async function main() {
  console.log(`\nFonts ahiya jashe: ${OUT_DIR}\n`);
  await mkdir(OUT_DIR, { recursive: true });

  const results = [];
  for (const font of FONTS) {
    results.push(await download(font));
  }

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${FONTS.length} fonts taiyar.`);

  if (ok === 0) {
    console.log(
      "\nEk pan download na thayo — vandho nahi, system na fonts vaparashe.\n" +
        "Internet aave tyare fari `npm run fonts` chalavo.",
    );
  }
}

main().catch((error) => {
  console.error("Fonts download fail:", error.message);
  process.exit(0); // Aa optional step che — build atkavvo nathi.
});
