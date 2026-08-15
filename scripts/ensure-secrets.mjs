/**
 * Makes sure the project has the secrets it needs, before anything starts.
 *
 * Runs automatically from the `predev`, `prebuild` and `prestart` hooks, so a
 * fresh clone works with no setup at all:
 *
 *   - creates `.env` from `.env.example` if it is missing
 *   - fills in any blank secret with a strong random value
 *
 * Why a real environment variable and not a generated file: the sign-in cookie
 * is verified in two different runtimes. Route handlers run on Node, but the
 * middleware runs on the Edge runtime, which has no filesystem. The only value
 * both can see is a genuine env var, so that is what this writes.
 *
 * Nothing already filled in is ever overwritten.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env");
const EXAMPLE_FILE = resolve(process.cwd(), ".env.example");

/** Secrets that must have a value, and how to generate one. */
const SECRETS = {
  JWT_SECRET: () => randomBytes(48).toString("base64url"),
  CRON_SECRET: () => randomBytes(24).toString("base64url"),
  META_WEBHOOK_VERIFY_TOKEN: () => randomBytes(16).toString("base64url"),
};

function main() {
  if (!existsSync(ENV_FILE)) {
    if (existsSync(EXAMPLE_FILE)) {
      copyFileSync(EXAMPLE_FILE, ENV_FILE);
      console.log("[setup] Created .env from .env.example");
    } else {
      writeFileSync(ENV_FILE, "", "utf8");
    }
  }

  let text = readFileSync(ENV_FILE, "utf8");
  const generated = [];

  for (const [name, make] of Object.entries(SECRETS)) {
    const line = new RegExp(`^${name}=(.*)$`, "m");
    const match = text.match(line);

    // Already has a real value? Leave it exactly as it is.
    const current = match?.[1]?.trim() ?? "";
    const placeholder = current.startsWith("change_this") || current === "";
    if (match && !placeholder) continue;

    const value = make();
    text = match
      ? text.replace(line, `${name}=${value}`)
      : `${text.trimEnd()}\n${name}=${value}\n`;
    generated.push(name);
  }

  if (generated.length === 0) return;

  writeFileSync(ENV_FILE, text, "utf8");
  console.log(`[setup] Generated ${generated.join(", ")} in .env`);
}

main();
