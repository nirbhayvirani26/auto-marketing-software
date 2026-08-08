import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import { MediaAsset } from "@/models/MediaAsset";

export const dynamic = "force-dynamic";

/**
 * Media ne bahar aapvanu route.
 *
 * ⚠️ Aa route JAANI JOINE public che (koi login nahi). Karan ke Meta na
 * server aa file download kare che — emni pase aapnu cookie na hoy. Id
 * random UUID che etle andaji ne kadhi shakay nahi.
 *
 * Video mate Range request support karvu farjiyat che — Meta ane browser
 * banne partial request mokle che.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  await connectDB();
  const asset = await MediaAsset.findById(id).lean();
  if (!asset?.localPath || !existsSync(asset.localPath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const size = statSync(asset.localPath).size;
  const headers = new Headers({
    "content-type": asset.mimeType,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "content-disposition": `inline; filename="${asset.filename}"`,
  });

  if (request.method === "HEAD") {
    headers.set("content-length", String(size));
    return new NextResponse(null, { status: 200, headers });
  }

  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

      if (Number.isNaN(start) || start >= size || end < start) {
        return new NextResponse(null, {
          status: 416,
          headers: { "content-range": `bytes */${size}` },
        });
      }

      headers.set("content-range", `bytes ${start}-${end}/${size}`);
      headers.set("content-length", String(end - start + 1));

      const stream = createReadStream(asset.localPath, { start, end });
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers,
      });
    }
  }

  headers.set("content-length", String(size));
  const stream = createReadStream(asset.localPath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers,
  });
}

export const HEAD = GET;
