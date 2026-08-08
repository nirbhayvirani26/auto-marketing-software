#!/usr/bin/env node
/**
 * `npm run build` — Next build, pan ek raksha sathe.
 *
 * Next build vakhate system na TEMP folder ne scan kare che. Windows par
 * e folder ma bija app na socket/lock file padela hoy che, jene vanchvani
 * paravanagi nathi hoti — ane aakho build "EACCES: permission denied,
 * scandir ...\\Temp\\..." kahine fail thai jaay che. Aa aapna code ni bhool
 * nathi, pan user ne to build fail j dekhay che.
 *
 * Etle build ne project ni andar no potano saaf temp folder aapi daiye chie.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const tempDir = path.join(process.cwd(), ".next", "build-tmp");

// Juno temp saaf karo — adhura build na avshesh nadta nathi.
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "build"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      TMP: tempDir,
      TEMP: tempDir,
      TMPDIR: tempDir,
    },
  },
);

child.on("exit", (code) => {
  rmSync(tempDir, { recursive: true, force: true });
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error("Build shuru na thai shakyo:", error.message);
  process.exit(1);
});
