import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getBlobReadWriteToken } from "@/lib/blobEnv";
import { isToolUnlocked, TOOL_UNLOCK_COOKIE } from "@/lib/toolAuth";

export const runtime = "nodejs";

/**
 * Tells the client whether the Blob-backed path is available (tool unlocked + token on server).
 * Uploads use POST /api/blobs/ingest (server put), not browser PUT to blob.vercel-storage.com.
 */
export async function GET() {
  if (!process.env.PASSWORD?.trim()) {
    return NextResponse.json({ toolUnlocked: false, clientUpload: false, blobTokenSet: false });
  }
  const cookieStore = await cookies();
  const toolUnlocked = isToolUnlocked(cookieStore.get(TOOL_UNLOCK_COOKIE)?.value);
  const blobTokenSet = Boolean(getBlobReadWriteToken());

  return NextResponse.json({
    toolUnlocked,
    blobTokenSet,
    /** True when the app may upload each file via /api/blobs/ingest for this session. */
    clientUpload: toolUnlocked && blobTokenSet,
  });
}
