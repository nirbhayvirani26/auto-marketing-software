/**
 * Local n8n chalu kare — data project ni andar `.n8n-data/` ma rahe che,
 * etle restart thay to pan workflows ane credentials jata nathi.
 *
 *   npm run n8n
 *
 * Band karva Ctrl+C.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.N8N_USER_FOLDER ?? join(projectRoot, ".n8n-data");

mkdirSync(dataDir, { recursive: true });

/** .env mathi value kadhe (n8n ne app ni URL ane secrets aapva mate). */
function readEnv(key) {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(join(projectRoot, file), "utf8");
      const match = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      // file nathi — vandho nahi
    }
  }
  return "";
}

/** n8n.cmd kya che e shodhe (npm global prefix badlay shake). */
function findN8n() {
  const candidates = [];
  if (process.env.N8N_BIN) candidates.push(process.env.N8N_BIN);

  const isWindows = process.platform === "win32";
  const binName = isWindows ? "n8n.cmd" : "n8n";

  // npm global prefix
  try {
    const { execSync } = require("node:child_process");
    const prefix = execSync("npm config get prefix", { encoding: "utf8" }).trim();
    candidates.push(join(prefix, binName));
    candidates.push(join(prefix, "bin", binName));
  } catch {
    // npm na male to niche na paths try thashe
  }

  if (isWindows) {
    candidates.push(join(process.env.APPDATA ?? "", "npm", binName));
    candidates.push(join("C:", "Program Files", "nodejs", binName));
  } else {
    candidates.push("/usr/local/bin/n8n", "/usr/bin/n8n");
  }

  return candidates.find((path) => path && existsSync(path)) ?? null;
}

const bin = findN8n();
if (!bin) {
  console.error("n8n madyu nahi. Pehla install karo:\n");
  console.error("  npm install -g n8n\n");
  console.error("Athva N8N_BIN env var ma pooro path aapo.");
  process.exit(1);
}

const appUrl = readEnv("APP_URL") || "http://127.0.0.1:3000";

const env = {
  ...process.env,
  N8N_USER_FOLDER: dataDir,
  // Localhost par https nathi, etle secure cookie band.
  N8N_SECURE_COOKIE: "false",
  N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
  // Workflows aa env vars vaapre che — .env mathi aapoaap bharay che.
  AM_BASE_URL: appUrl,
  AM_CRON_SECRET: readEnv("CRON_SECRET"),
  AM_N8N_SECRET: readEnv("N8N_WEBHOOK_SECRET"),
  AM_TOKEN: readEnv("N8N_API_TOKEN"),
};

console.log(`Starting n8n`);
console.log(`  binary : ${bin}`);
console.log(`  data   : ${dataDir}`);
console.log(`  app    : ${appUrl}`);
if (!env.AM_TOKEN) {
  console.log(
    `  ⚠ N8N_API_TOKEN .env ma nathi — Integrations page par token banavine nakho`,
  );
}
console.log(`\n  UI: http://localhost:5678   (Ctrl+C thi band)\n`);

/**
 * Windows par `.cmd` ne shell joiye che, pan tyare path na spaces
 * ("C:\Program Files\…") todi naakhe che — etle quote karvu pade.
 */
const isCmd = bin.toLowerCase().endsWith(".cmd") || bin.toLowerCase().endsWith(".bat");
const child = isCmd
  ? spawn(`"${bin}" start`, { env, stdio: "inherit", shell: true })
  : spawn(bin, ["start"], { env, stdio: "inherit" });

const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
