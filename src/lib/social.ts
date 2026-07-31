import { env } from "./env";

const GRAPH = () => `https://graph.facebook.com/${env.metaGraphVersion}`;

export type PublishResult = {
  externalPostId: string;
  permalink?: string;
};

async function graphRequest<T>(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "POST",
): Promise<T> {
  const url = new URL(`${GRAPH()}${path}`);
  let init: RequestInit = { method };

  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  } else {
    init = { method, body: new URLSearchParams(params) };
  }

  const response = await fetch(url, init);
  const json = (await response.json()) as T & {
    error?: { message: string; type: string; code: number };
  };

  if (!response.ok || json.error) {
    const message = json.error?.message ?? `Graph API ${response.status}`;
    throw new Error(`Meta Graph API: ${message}`);
  }
  return json;
}

/**
 * Facebook Page par publish kare.
 * Image hoy to /photos, nahi to /feed.
 */
export async function publishToFacebook(opts: {
  pageId: string;
  accessToken: string;
  message: string;
  imageUrl?: string;
}): Promise<PublishResult> {
  if (opts.imageUrl) {
    const result = await graphRequest<{ id: string; post_id?: string }>(
      `/${opts.pageId}/photos`,
      {
        url: opts.imageUrl,
        caption: opts.message,
        access_token: opts.accessToken,
      },
    );
    const postId = result.post_id ?? result.id;
    return {
      externalPostId: postId,
      permalink: `https://www.facebook.com/${postId}`,
    };
  }

  const result = await graphRequest<{ id: string }>(`/${opts.pageId}/feed`, {
    message: opts.message,
    access_token: opts.accessToken,
  });
  return {
    externalPostId: result.id,
    permalink: `https://www.facebook.com/${result.id}`,
  };
}

/**
 * Instagram Content Publishing API — be step:
 *  1. /media       -> container banavo
 *  2. /media_publish -> publish karo
 *
 * IG ne PUBLIC image URL joiye j che (localhost nahi chale).
 */
export async function publishToInstagram(opts: {
  igUserId: string;
  accessToken: string;
  caption: string;
  imageUrl: string;
}): Promise<PublishResult> {
  if (!opts.imageUrl) {
    throw new Error(
      "Instagram post mate image URL farjiyat che (public https URL hovu joiye).",
    );
  }

  const container = await graphRequest<{ id: string }>(
    `/${opts.igUserId}/media`,
    {
      image_url: opts.imageUrl,
      caption: opts.caption,
      access_token: opts.accessToken,
    },
  );

  const published = await graphRequest<{ id: string }>(
    `/${opts.igUserId}/media_publish`,
    {
      creation_id: container.id,
      access_token: opts.accessToken,
    },
  );

  let permalink: string | undefined;
  try {
    const meta = await graphRequest<{ permalink: string }>(
      `/${published.id}`,
      { fields: "permalink", access_token: opts.accessToken },
      "GET",
    );
    permalink = meta.permalink;
  } catch {
    // Permalink optional che — publish safal thai gayu che.
  }

  return { externalPostId: published.id, permalink };
}

/* ------------------------------------------------------------------ *
 *  Comment reply + private DM
 * ------------------------------------------------------------------ */

/**
 * Comment ni niche jaher ma jawab aape (Facebook ane Instagram — banne).
 */
export async function replyToComment(opts: {
  commentId: string;
  accessToken: string;
  message: string;
}): Promise<{ id: string }> {
  return graphRequest<{ id: string }>(`/${opts.commentId}/replies`, {
    message: opts.message,
    access_token: opts.accessToken,
  });
}

/**
 * Facebook: comment karnar ne Messenger ma private reply mokle.
 *
 * ⚠️ Meta ni limit — ek comment dith fakt EK private reply, ane comment
 * thaya na 7 divas ni andar. Bija prayatne API error aape che.
 */
export async function sendFacebookPrivateReply(opts: {
  commentId: string;
  accessToken: string;
  message: string;
}): Promise<{ id: string }> {
  return graphRequest<{ id: string }>(`/${opts.commentId}/private_replies`, {
    message: opts.message,
    access_token: opts.accessToken,
  });
}

/**
 * Instagram: comment karnar ne DM mokle.
 *
 * IG ma alag endpoint che — Page na IG-scoped messages endpoint par
 * `recipient: { comment_id }` mokalvu pade che.
 * `instagram_manage_messages` permission joiye che.
 */
export async function sendInstagramPrivateReply(opts: {
  igUserId: string;
  accessToken: string;
  commentId: string;
  message: string;
}): Promise<{ message_id?: string }> {
  const url = new URL(`${GRAPH()}/${opts.igUserId}/messages`);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { comment_id: opts.commentId },
      message: { text: opts.message },
      access_token: opts.accessToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const json = (await response.json()) as {
    message_id?: string;
    error?: { message: string };
  };
  if (!response.ok || json.error) {
    throw new Error(
      `Instagram DM: ${json.error?.message ?? response.status}`,
    );
  }
  return json;
}

/**
 * Meta ne kaho ke aa Page na comments/messages na updates aapna webhook par
 * moklo. Aa ek j vaar karvanu hoy che (account connect thay tyare).
 */
export async function subscribePageWebhooks(opts: {
  pageId: string;
  accessToken: string;
}): Promise<{ success: boolean }> {
  return graphRequest<{ success: boolean }>(
    `/${opts.pageId}/subscribed_apps`,
    {
      subscribed_fields: "feed,mention,messages,messaging_postbacks",
      access_token: opts.accessToken,
    },
  );
}

/** Caption + hashtags ne ek publishable string ma jode. */
export function composeCaption(caption: string, hashtags: string[]): string {
  if (!hashtags.length) return caption;
  const tags = hashtags
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .join(" ");
  return `${caption}\n\n${tags}`;
}
