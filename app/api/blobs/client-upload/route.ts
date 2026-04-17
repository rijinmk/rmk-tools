import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getBlobReadWriteToken } from "@/lib/blobEnv";
import { MAX_BYTES_PER_FILE } from "@/lib/convertInputs";
import { isToolUnlocked, TOOL_UNLOCK_COOKIE } from "@/lib/toolAuth";

export const runtime = "nodejs";

const UPLOAD_PATH_PREFIX = "flyer-uploads/";

export async function POST(request: Request) {
  const blobToken = getBlobReadWriteToken();
  if (!blobToken) {
    return NextResponse.json(
      {
        error:
          "Missing BLOB_READ_WRITE_TOKEN (or VERCEL_BLOB_READ_WRITE_TOKEN). In Vercel: Storage → Blob → create/link a store so the token is injected, then redeploy.",
      },
      { status: 503 },
    );
  }

  if (!process.env.PASSWORD?.trim()) {
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 503 });
  }

  const cookieStore = await cookies();
  if (!isToolUnlocked(cookieStore.get(TOOL_UNLOCK_COOKIE)?.value)) {
    return NextResponse.json(
      { error: "Unauthorized. Unlock the tool on this site first." },
      { status: 401 },
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      request,
      body,
      token: blobToken,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(UPLOAD_PATH_PREFIX)) {
          throw new Error(`Invalid pathname (must start with ${UPLOAD_PATH_PREFIX}).`);
        }
        return {
          allowedContentTypes: [
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
          ],
          maximumSizeInBytes: MAX_BYTES_PER_FILE,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Blob upload token error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
