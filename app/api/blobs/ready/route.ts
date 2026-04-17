import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getBlobReadWriteToken } from "@/lib/blobEnv";
import { isToolUnlocked, TOOL_UNLOCK_COOKIE } from "@/lib/toolAuth";

export const runtime = "nodejs";

/**
 * Tells the client whether direct-to-Blob uploads are available (tool unlocked + token on server).
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
    /** True only when the browser may use client → Blob uploads for this session. */
    clientUpload: toolUnlocked && blobTokenSet,
  });
}
