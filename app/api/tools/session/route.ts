import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isToolUnlocked, TOOL_UNLOCK_COOKIE } from "@/lib/toolAuth";

export async function GET() {
  const cookieStore = await cookies();
  const unlocked = isToolUnlocked(cookieStore.get(TOOL_UNLOCK_COOKIE)?.value);
  const passwordConfigured = Boolean(process.env.PASSWORD?.trim());

  return NextResponse.json({
    unlocked,
    passwordConfigured,
  });
}
