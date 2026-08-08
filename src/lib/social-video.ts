/**
 * Video publishing — Instagram Reels ane Facebook Reels.
 *
 * Aa image post karta ghanu alag che, etle alag file ma rakhyu che.
 *
 * ⚠️ BE VAAT JE KHABAR HOVI JOIYE:
 *
 * 1. Meta na server TAMARA URL par thi video DOWNLOAD kare che. Etle
 *    `localhost` kyarey nahi chale — public https URL joiye j. Aapno media
 *    store aa aapoaap sambhale che (Cloudinary/Catbox/tunnel).
 *
 * 2. Instagram nu trending SONG aa API thi lagavi shakatu nathi. Meta e
 *    music catalog API ma kholyu j nathi. Video ni andar bake karelu music
 *    j jaay che. Trending sound joito hoy to publish pachi IG app ma
 *    2 tap ma badli shakay — app ma e suchav aapiye chie.
 */

import { env } from "./env";

const GRAPH = () => `https://graph.facebook.com/${env.metaGraphVersion}`;

export type VideoPublishResult = {
  externalPostId: string;
  permalink?: string;
  containerId?: string;
};

async function graph<T>(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "POST",
): Promise<T> {
  const url = new URL(`${GRAPH()}${path}`);
  let init: RequestInit = { method, signal: AbortSignal.timeout(120_000) };

  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  } else {
    init = { ...init, body: new URLSearchParams(params) };
  }

  const response = await fetch(url, init);
  const json = (await response.json()) as T & {
    error?: { message: string; type: string; code: number; error_user_msg?: string };
  };

  if (!response.ok || json.error) {
    const error = json.error;
    throw new Error(
      `Meta Graph API: ${error?.error_user_msg ?? error?.message ?? `HTTP ${response.status}`}`,
    );
  }
  return json;
}

/* ------------------------------------------------------------------ *
 *  Instagram
 * ------------------------------------------------------------------ */

export type ContainerStatus = {
  status_code: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  status?: string;
};

/**
 * IG video container taiyar thay eni raah jue.
 *
 * IG video ne transcode karta 30 second thi 2 minute lage che. Turant
 * publish karvano prayatna karie to "Media ID is not available" aave che.
 * Etle status FINISHED thay tya sudhi puchtaa rahevu pade.
 */
export async function waitForInstagramContainer(opts: {
  containerId: string;
  accessToken: string;
  timeoutMs?: number;
  onTick?: (status: string, elapsedMs: number) => void;
}): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  const started = Date.now();
  let delay = 3000;

  for (;;) {
    const status = await graph<ContainerStatus>(
      `/${opts.containerId}`,
      { fields: "status_code,status", access_token: opts.accessToken },
      "GET",
    );

    opts.onTick?.(status.status_code, Date.now() - started);

    if (status.status_code === "FINISHED" || status.status_code === "PUBLISHED") return;

    if (status.status_code === "ERROR") {
      throw new Error(
        `Instagram e video na svikarayu: ${status.status ?? "ERROR"}. ` +
          "Mota bhage aanu karan — video no URL public nathi, ke format barabar nathi (mp4/h264/aac joiye).",
      );
    }
    if (status.status_code === "EXPIRED") {
      throw new Error("Instagram container ni muddat puri thai gai — fari try karo.");
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Instagram e ${Math.round((opts.timeoutMs ?? 300_000) / 1000)}s ma video process na karyu. Nani/halki reel thi try karo.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.4, 15_000);
  }
}

/**
 * Instagram Reel publish kare.
 *
 * Traan tabakka: container banavo → process thay eni raah jovo → publish.
 */
export async function publishReelToInstagram(opts: {
  igUserId: string;
  accessToken: string;
  caption: string;
  videoUrl: string;
  coverUrl?: string;
  /** true = reel main feed ma pan dekhaay (recommended). */
  shareToFeed?: boolean;
  /** Location tag — reach thodo vadhare che. */
  locationId?: string;
  collaborators?: string[];
  onProgress?: (step: string) => void;
}): Promise<VideoPublishResult> {
  if (!/^https:\/\//i.test(opts.videoUrl)) {
    throw new Error(
      "Instagram ne PUBLIC https URL joiye. localhost nahi chale — Setup page ma Cloudinary ni free key naakho, ke PUBLIC_MEDIA_BASE_URL set karo.",
    );
  }

  opts.onProgress?.("Instagram par container banavie chie");

  const params: Record<string, string> = {
    media_type: "REELS",
    video_url: opts.videoUrl,
    caption: opts.caption.slice(0, 2200),
    share_to_feed: String(opts.shareToFeed ?? true),
    access_token: opts.accessToken,
  };
  if (opts.coverUrl && /^https:\/\//i.test(opts.coverUrl)) {
    params.cover_url = opts.coverUrl;
  }
  if (opts.locationId) params.location_id = opts.locationId;
  if (opts.collaborators?.length) {
    params.collaborators = JSON.stringify(opts.collaborators.slice(0, 3));
  }

  const container = await graph<{ id: string }>(`/${opts.igUserId}/media`, params);

  opts.onProgress?.("Instagram video process kari rahyu che");
  await waitForInstagramContainer({
    containerId: container.id,
    accessToken: opts.accessToken,
    onTick: (status) => opts.onProgress?.(`Instagram: ${status}`),
  });

  opts.onProgress?.("Publish karie chie");
  const published = await graph<{ id: string }>(`/${opts.igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: opts.accessToken,
  });

  let permalink: string | undefined;
  try {
    const meta = await graph<{ permalink: string }>(
      `/${published.id}`,
      { fields: "permalink", access_token: opts.accessToken },
      "GET",
    );
    permalink = meta.permalink;
  } catch {
    // Permalink na madyu to pan post to thai j gayi che.
  }

  return { externalPostId: published.id, permalink, containerId: container.id };
}

/** Instagram Story — image ke video. 24 kalak rahe che. */
export async function publishStoryToInstagram(opts: {
  igUserId: string;
  accessToken: string;
  mediaUrl: string;
  mediaType: "image" | "video";
}): Promise<VideoPublishResult> {
  const params: Record<string, string> = {
    media_type: "STORIES",
    access_token: opts.accessToken,
  };
  if (opts.mediaType === "video") params.video_url = opts.mediaUrl;
  else params.image_url = opts.mediaUrl;

  const container = await graph<{ id: string }>(`/${opts.igUserId}/media`, params);

  if (opts.mediaType === "video") {
    await waitForInstagramContainer({
      containerId: container.id,
      accessToken: opts.accessToken,
    });
  }

  const published = await graph<{ id: string }>(`/${opts.igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: opts.accessToken,
  });

  return { externalPostId: published.id, containerId: container.id };
}

/**
 * Instagram Carousel — 2 thi 10 image/video ek j post ma.
 * Swipe ek majbut ranking signal che, etle ghana product hoy tyare
 * carousel single image karta saaro chale che.
 */
export async function publishCarouselToInstagram(opts: {
  igUserId: string;
  accessToken: string;
  caption: string;
  items: Array<{ url: string; type: "image" | "video" }>;
  onProgress?: (step: string) => void;
}): Promise<VideoPublishResult> {
  if (opts.items.length < 2 || opts.items.length > 10) {
    throw new Error("Carousel ma 2 thi 10 vachhe item hova joiye");
  }

  const childIds: string[] = [];
  for (const [index, item] of opts.items.entries()) {
    opts.onProgress?.(`Carousel item ${index + 1}/${opts.items.length}`);

    const params: Record<string, string> = {
      is_carousel_item: "true",
      access_token: opts.accessToken,
    };
    if (item.type === "video") {
      params.media_type = "VIDEO";
      params.video_url = item.url;
    } else {
      params.image_url = item.url;
    }

    const child = await graph<{ id: string }>(`/${opts.igUserId}/media`, params);

    if (item.type === "video") {
      await waitForInstagramContainer({
        containerId: child.id,
        accessToken: opts.accessToken,
      });
    }
    childIds.push(child.id);
  }

  opts.onProgress?.("Carousel jodie chie");
  const container = await graph<{ id: string }>(`/${opts.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption: opts.caption.slice(0, 2200),
    access_token: opts.accessToken,
  });

  const published = await graph<{ id: string }>(`/${opts.igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: opts.accessToken,
  });

  let permalink: string | undefined;
  try {
    const meta = await graph<{ permalink: string }>(
      `/${published.id}`,
      { fields: "permalink", access_token: opts.accessToken },
      "GET",
    );
    permalink = meta.permalink;
  } catch {
    /* optional */
  }

  return { externalPostId: published.id, permalink, containerId: container.id };
}

/** Aa account e chhella 24 kalak ma ketli post kari — IG ni limit 25 che. */
export async function instagramQuotaUsage(opts: {
  igUserId: string;
  accessToken: string;
}): Promise<{ used: number; limit: number }> {
  const json = await graph<{
    data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>;
  }>(
    `/${opts.igUserId}/content_publishing_limit`,
    { fields: "quota_usage,config", access_token: opts.accessToken },
    "GET",
  );

  const row = json.data?.[0];
  return {
    used: row?.quota_usage ?? 0,
    limit: row?.config?.quota_total ?? 25,
  };
}

/* ------------------------------------------------------------------ *
 *  Facebook
 * ------------------------------------------------------------------ */

/**
 * Facebook Reel publish kare.
 *
 * Traan tabakka:
 *   1. start  → video_id ane upload_url male
 *   2. upload → aapne fakt public URL aapiye chie, FB potane utari le che
 *   3. finish → publish
 */
export async function publishReelToFacebook(opts: {
  pageId: string;
  accessToken: string;
  description: string;
  videoUrl: string;
  onProgress?: (step: string) => void;
}): Promise<VideoPublishResult> {
  if (!/^https:\/\//i.test(opts.videoUrl)) {
    throw new Error("Facebook ne pan PUBLIC https URL joiye — localhost nahi chale.");
  }

  opts.onProgress?.("Facebook par upload session banavie chie");
  const start = await graph<{ video_id: string; upload_url: string }>(
    `/${opts.pageId}/video_reels`,
    { upload_phase: "start", access_token: opts.accessToken },
  );

  opts.onProgress?.("Facebook video utari rahyu che");
  const uploadResponse = await fetch(start.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${opts.accessToken}`,
      file_url: opts.videoUrl,
    },
    signal: AbortSignal.timeout(10 * 60_000),
  });

  const uploadJson = (await uploadResponse.json().catch(() => ({}))) as {
    success?: boolean;
    error?: { message?: string };
  };
  if (!uploadResponse.ok || uploadJson.error) {
    throw new Error(
      `Facebook upload fail: ${uploadJson.error?.message ?? uploadResponse.status}`,
    );
  }

  opts.onProgress?.("Facebook par publish karie chie");
  const finish = await graph<{ success: boolean; post_id?: string }>(
    `/${opts.pageId}/video_reels`,
    {
      video_id: start.video_id,
      upload_phase: "finish",
      video_state: "PUBLISHED",
      description: opts.description.slice(0, 2200),
      access_token: opts.accessToken,
    },
  );

  const postId = finish.post_id ?? start.video_id;
  return {
    externalPostId: postId,
    permalink: `https://www.facebook.com/reel/${start.video_id}`,
    containerId: start.video_id,
  };
}

/**
 * Facebook Page par sadho video (feed ma).
 * Reels API koi karan sar fail thay to aa backup rasto che.
 */
export async function publishVideoToFacebook(opts: {
  pageId: string;
  accessToken: string;
  description: string;
  videoUrl: string;
  title?: string;
}): Promise<VideoPublishResult> {
  const params: Record<string, string> = {
    file_url: opts.videoUrl,
    description: opts.description.slice(0, 2200),
    access_token: opts.accessToken,
  };
  if (opts.title) params.title = opts.title.slice(0, 255);

  const result = await graph<{ id: string }>(`/${opts.pageId}/videos`, params);

  return {
    externalPostId: result.id,
    permalink: `https://www.facebook.com/${result.id}`,
  };
}

/** Facebook Story — 24 kalak. */
export async function publishStoryToFacebook(opts: {
  pageId: string;
  accessToken: string;
  videoUrl: string;
}): Promise<VideoPublishResult> {
  const start = await graph<{ video_id: string; upload_url: string }>(
    `/${opts.pageId}/video_stories`,
    { upload_phase: "start", access_token: opts.accessToken },
  );

  const uploadResponse = await fetch(start.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${opts.accessToken}`,
      file_url: opts.videoUrl,
    },
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!uploadResponse.ok) {
    throw new Error(`Facebook story upload fail: ${uploadResponse.status}`);
  }

  const finish = await graph<{ success: boolean; post_id?: string }>(
    `/${opts.pageId}/video_stories`,
    {
      video_id: start.video_id,
      upload_phase: "finish",
      access_token: opts.accessToken,
    },
  );

  return {
    externalPostId: finish.post_id ?? start.video_id,
    containerId: start.video_id,
  };
}

/**
 * Post thaya pachi pehla comment ma hashtag mukvano.
 *
 * Instagram par aa saras practice che — caption saaf rahe che ane hashtag
 * nu kaam pan thai jaay che. Meta banne platform par ek j endpoint aape che.
 */
export async function commentOnPost(opts: {
  mediaId: string;
  accessToken: string;
  message: string;
}): Promise<{ id: string }> {
  return graph<{ id: string }>(`/${opts.mediaId}/comments`, {
    message: opts.message.slice(0, 2200),
    access_token: opts.accessToken,
  });
}
