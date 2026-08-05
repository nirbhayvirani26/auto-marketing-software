/**
 * n8n ne app saathe jodi de che — ek j command ma:
 *
 *   1. app ma login karine n8n mate API token banave
 *   2. e token .env ma save kare (N8N_API_TOKEN)
 *   3. n8n ma owner account banave (pehli var)
 *   4. n8n/*.json workflows import kare — asli token/secrets bharine
 *   5. workflows activate kare
 *
 *   npm run n8n:setup
 *
 * Fari fari chalavi shakay — juna workflows update thay che.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const N8N = process.env.N8N_URL ?? "http://127.0.0.1:5678";

/* ---------------- env helpers ---------------- */

function envPath() {
  return join(projectRoot, ".env");
}

function readEnv(key) {
  try {
    const raw = readFileSync(envPath(), "utf8");
    const match = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

function writeEnv(key, value) {
  let raw = readFileSync(envPath(), "utf8");
  if (new RegExp(`^${key}=`, "m").test(raw)) {
    raw = raw.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  } else {
    raw += `\n${key}=${value}\n`;
  }
  writeFileSync(envPath(), raw);
}

/* ---------------- tiny http helper ---------------- */

let cookieJar = "";

async function http(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(cookieJar ? { cookie: cookieJar } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookieJar = setCookie.map((c) => c.split(";")[0]).join("; ");
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

/* ---------------- steps ---------------- */

const APP = readEnv("APP_URL") || "http://127.0.0.1:3000";

/** App (Auto Marketing) no login — token banavva mate. */
const APP_EMAIL = readEnv("SEED_ADMIN_EMAIL") || "admin@example.com";
const APP_PASSWORD = readEnv("SEED_ADMIN_PASSWORD") || "Admin@12345";

/**
 * n8n no potano login — app na login thi alag rakhyu che, jethi ek badlo
 * to biju na ambhay.
 */
const N8N_EMAIL = readEnv("N8N_EMAIL") || APP_EMAIL;
const N8N_PASSWORD = readEnv("N8N_PASSWORD") || APP_PASSWORD;

async function ensureAppToken() {
  const existing = readEnv("N8N_API_TOKEN");
  if (existing) {
    // Token hju chale che ke nahi check karo.
    const check = await http(`${APP}/api/v1/accounts`, {
      headers: { authorization: `Bearer ${existing}` },
    });
    if (check.ok) {
      console.log("✔ App API token pehla thi che ane chale che");
      return existing;
    }
    console.log("… juno token nathi chalto, navo banavu chu");
  }

  const login = await http(`${APP}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: APP_EMAIL, password: APP_PASSWORD }),
  });
  if (!login.ok) {
    throw new Error(
      `App ma login na thayu (${APP_EMAIL}): ${login.json.error ?? login.status}`,
    );
  }

  const created = await http(`${APP}/api/tokens`, {
    method: "POST",
    body: JSON.stringify({
      name: "n8n local",
      scopes: [
        "posts:read",
        "posts:write",
        "posts:publish",
        "ai:generate",
        "automations:run",
        "accounts:read",
      ],
    }),
  });
  if (!created.ok) {
    throw new Error(`Token na banyo: ${created.json.error ?? created.status}`);
  }

  const token = created.json.data.token;
  writeEnv("N8N_API_TOKEN", token);
  console.log(`✔ Navo App API token banyo ane .env ma save thayo`);
  return token;
}

async function ensureN8nOwner() {
  const settings = await http(`${N8N}/rest/settings`);
  if (!settings.ok) {
    throw new Error(
      `n8n sudhi pahonchi na shakaya (${N8N}). Pehla \`npm run n8n\` chalavo.`,
    );
  }

  const needsSetup = settings.json?.data?.userManagement?.showSetupOnFirstLoad;
  if (needsSetup) {
    const setup = await http(`${N8N}/rest/owner/setup`, {
      method: "POST",
      body: JSON.stringify({
        email: N8N_EMAIL,
        firstName: "Auto",
        lastName: "Marketing",
        password: N8N_PASSWORD,
      }),
    });
    if (!setup.ok) throw new Error(`n8n owner na banyo: ${setup.status}`);
    console.log(`✔ n8n owner banyo: ${N8N_EMAIL}`);
    return;
  }

  const login = await http(`${N8N}/rest/login`, {
    method: "POST",
    body: JSON.stringify({ emailOrLdapLoginId: N8N_EMAIL, password: N8N_PASSWORD }),
  });
  if (!login.ok) {
    throw new Error(
      `n8n ma login na thayu. n8n UI (${N8N}) ma jate login karo, athva ` +
        `.n8n-data folder delete karine fari try karo.`,
    );
  }
  console.log("✔ n8n ma login thayu");
}

/** Workflow JSON ma env placeholders ne asli value thi badle. */
function materialise(raw, values) {
  let out = raw;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{ $env.${key} }}`).join(value);
  }
  return out;
}

async function importWorkflows(token) {
  const dir = join(projectRoot, "n8n");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

  const values = {
    AM_BASE_URL: APP,
    AM_TOKEN: token,
    AM_CRON_SECRET: readEnv("CRON_SECRET"),
    AM_N8N_SECRET: readEnv("N8N_WEBHOOK_SECRET"),
  };

  const existing = await http(`${N8N}/rest/workflows`);
  const byName = new Map(
    (existing.json?.data ?? []).map((w) => [w.name, w]),
  );

  for (const file of files) {
    const raw = readFileSync(join(dir, file), "utf8");
    const workflow = JSON.parse(materialise(raw, values));

    const payload = {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings ?? { executionOrder: "v1" },
    };

    const found = byName.get(workflow.name);
    let id;

    if (found) {
      const updated = await http(`${N8N}/rest/workflows/${found.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, versionId: found.versionId }),
      });
      if (!updated.ok) {
        console.log(`  ✗ ${workflow.name} update na thayu (${updated.status})`);
        continue;
      }
      id = found.id;
      console.log(`  ↻ update: ${workflow.name}`);
    } else {
      const created = await http(`${N8N}/rest/workflows`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!created.ok) {
        console.log(`  ✗ ${workflow.name} import na thayu (${created.status})`);
        continue;
      }
      id = created.json.data.id;
      console.log(`  + import: ${workflow.name}`);
    }

    // Webhook-vali ane schedule-vali workflows ne activate karo.
    // ("Roj AI post" pan schedule par che, etle badhi activate thay che.)
    await activate(id, workflow.name);
  }
}

/**
 * Activation fakt n8n na PUBLIC API thi thay che — internal `/rest` no
 * PATCH `active` field chup-chap ignore kare che (200 aape pan off j rahe).
 * Etle ek short-lived public API key banavine e vaparie chie.
 */
let publicApiKey = null;

async function getPublicApiKey() {
  if (publicApiKey) return publicApiKey;

  const created = await http(`${N8N}/rest/api-keys`, {
    method: "POST",
    body: JSON.stringify({
      label: `auto-marketing-setup-${Date.now()}`,
      expiresAt: null,
      scopes: [
        "workflow:read",
        "workflow:list",
        "workflow:update",
        "workflow:activate",
      ],
    }),
  });

  // Plain key fakt create vakhte j maley che (`rawApiKey`);
  // list endpoint ene mask kari de che.
  publicApiKey = created.json?.data?.rawApiKey ?? null;
  return publicApiKey;
}

async function activate(id, name) {
  const key = await getPublicApiKey();
  if (!key) {
    console.log(`     ⚠ off — n8n UI ma toggle on karo  ${name}`);
    return;
  }

  const response = await fetch(`${N8N}/api/v1/workflows/${id}/activate`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": key },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));

  console.log(
    body.active === true
      ? `     ✔ ACTIVE  ${name}`
      : `     ⚠ off (${response.status}) — n8n UI ma toggle on karo  ${name}`,
  );
}

/* ---------------- main ---------------- */

async function main() {
  console.log(`App : ${APP}`);
  console.log(`n8n : ${N8N}\n`);

  const token = await ensureAppToken();
  await ensureN8nOwner();
  console.log("\nWorkflows:");
  await importWorkflows(token);

  console.log(`\n✔ Thai gayu — n8n kholo: ${N8N}`);
  console.log(`  login: ${N8N_EMAIL} / ${N8N_PASSWORD}`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
