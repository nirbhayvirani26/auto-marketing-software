import { createHmac, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Facebook Login (OAuth 2.0) — user ne Facebook par mokli, pachi tena
 * Pages ane jodayela Instagram Business accounts fetch kare che.
 *
 * Flow:
 *  1. /api/oauth/meta/start     -> Facebook dialog par redirect
 *  2. Facebook -> /api/oauth/meta/callback?code=...
 *  3. code -> short-lived user token -> long-lived user token
 *  4. /me/accounts -> Pages + page access tokens (aa kadi expire nathi thata)
 *  5. dareak Page no instagram_business_account -> IG account
 */

const GRAPH = () => `https://graph.facebook.com/${env.metaGraphVersion}`;

/** Publish karva mate jaruri permissions. */
export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
].join(",");

export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function redirectUri(): string {
  return `${env.appUrl.replace(/\/$/, "")}/api/oauth/meta/callback`;
}

/**
 * CSRF `state` — signed che, etle server ne alag storage rakhvi nathi padti.
 */
export function createState(): string {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = Date.now();
  const payload = `${nonce}.${issuedAt}`;
  const signature = createHmac("sha256", env.jwtSecret)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

export function verifyState(state: string | null): boolean {
  if (!state) return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;

  const [nonce, issuedAt, signature] = parts;
  const expected = createHmac("sha256", env.jwtSecret)
    .update(`${nonce}.${issuedAt}`)
    .digest("hex");
  if (signature !== expected) return false;

  // 10 minute ma callback aavvu joiye.
  return Date.now() - Number(issuedAt) < 10 * 60 * 1000;
}

export function authorizeUrl(state: string): string {
  const url = new URL(
    `https://www.facebook.com/${env.metaGraphVersion}/dialog/oauth`,
  );
  url.searchParams.set("client_id", process.env.META_APP_ID || "");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_SCOPES);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

async function graphGet<T>(path: string, params: Record<string, string>) {
  const url = new URL(`${GRAPH()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const json = (await response.json()) as T & {
    error?: { message: string };
  };
  if (!response.ok || json.error) {
    throw new Error(json.error?.message ?? `Graph API ${response.status}`);
  }
  return json;
}

/** Authorization code -> long-lived user access token. */
export async function exchangeCodeForUserToken(code: string): Promise<string> {
  const short = await graphGet<{ access_token: string }>("/oauth/access_token", {
    client_id: process.env.META_APP_ID || "",
    client_secret: process.env.META_APP_SECRET || "",
    redirect_uri: redirectUri(),
    code,
  });

  // Long-lived token ~60 divas chale che; ena parthi malta Page tokens
  // kadi expire nathi thata.
  const long = await graphGet<{ access_token: string }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID || "",
    client_secret: process.env.META_APP_SECRET || "",
    fb_exchange_token: short.access_token,
  });

  return long.access_token;
}

export type DiscoveredAccount = {
  platform: "facebook" | "instagram";
  displayName: string;
  pageId?: string;
  igUserId?: string;
  accessToken: string;
  avatarUrl?: string;
};

/**
 * User na badha Pages ane tema jodayela IG Business accounts kadhe che.
 */
export async function discoverAccounts(
  userAccessToken: string,
): Promise<DiscoveredAccount[]> {
  const pages = await graphGet<{
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: { id: string };
    }>;
  }>("/me/accounts", {
    fields:
      "id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}",
    limit: "100",
    access_token: userAccessToken,
  });

  const discovered: DiscoveredAccount[] = [];

  for (const page of pages.data ?? []) {
    discovered.push({
      platform: "facebook",
      displayName: page.name,
      pageId: page.id,
      accessToken: page.access_token,
      avatarUrl: page.picture?.data?.url,
    });

    const ig = page.instagram_business_account as
      | { id: string; username?: string; profile_picture_url?: string }
      | undefined;

    if (ig?.id) {
      discovered.push({
        platform: "instagram",
        displayName: ig.username ? `@${ig.username}` : `${page.name} (Instagram)`,
        igUserId: ig.id,
        // IG publishing Page token thi j thay che.
        accessToken: page.access_token,
        avatarUrl: ig.profile_picture_url,
      });
    }
  }

  return discovered;
}
