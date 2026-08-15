import { crawlWebsite } from "./crawler";
import { logActivity } from "@/models/ActivityLog";
import { Website } from "@/models/Website";

/**
 * Crawls one connected store and stores what it finds.
 *
 * Lives here rather than in a route file because two routes need it — connect
 * with `sync: true`, and the explicit re-import button — and a Next.js route
 * module may only export request handlers.
 */
export async function syncWebsite(websiteId: string, brandId: string): Promise<void> {
  const website = await Website.findOne({ _id: websiteId, brand: brandId });
  if (!website) return;

  website.syncStatus = "syncing";
  website.syncError = undefined;
  await website.save();

  const started = Date.now();

  try {
    const result = await crawlWebsite(website.url);

    // Anything added by hand is kept — the crawler must never delete work the
    // seller did themselves.
    const manual = (website.products ?? []).filter((item) => item.source === "manual");
    const crawled = result.products.filter(
      (item) => !manual.some((existing) => existing.url === item.url),
    );

    website.products = [
      ...manual,
      ...crawled.map((item) => ({ ...item, foundAt: new Date() })),
    ];
    website.platform = result.platform;
    website.syncSources = result.sources;
    website.syncStatus = "ok";
    website.lastSyncedAt = new Date();
    website.lastSyncMs = Date.now() - started;
    await website.save();

    await logActivity({
      level: result.products.length > 0 ? "success" : "warning",
      action: "website.synced",
      message: `${website.host} — ${result.products.length} products found`,
      meta: { sources: result.sources },
    });
  } catch (error) {
    website.syncStatus = "failed";
    website.syncError = (error as Error).message.slice(0, 300);
    website.lastSyncMs = Date.now() - started;
    await website.save();

    await logActivity({
      level: "error",
      action: "website.sync_failed",
      message: `${website.host} — ${(error as Error).message}`,
    });
  }
}
