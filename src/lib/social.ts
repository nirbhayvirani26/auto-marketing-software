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

/** Caption + hashtags ne ek publishable string ma jode. */
export function composeCaption(caption: string, hashtags: string[]): string {
  if (!hashtags.length) return caption;
  const tags = hashtags
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .join(" ");
  return `${caption}\n\n${tags}`;
}
