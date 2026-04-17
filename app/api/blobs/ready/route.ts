import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isToolUnlocked, TOOL_UNLOCK_COOKIE } from "@/lib/toolAuth";

export const runtime = "nodejs";

/**
 * Tells the client whether direct-to-Blob uploads are configured (unlocks large batches on Vercel).
 */
export async function GET() {
  if (!process.env.PASSWORD?.trim()) {
    return NextResponse.json({ clientUpload: false });
  }
  const cookieStore = await cookies();
  if (!isToolUnlocked(cookieStore.get(TOOL_UNLOCK_COOKIE)?.value)) {
    return NextResponse.json({ clientUpload: false });
  }

  return NextResponse.json({
    clientUpload: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
  });
}
