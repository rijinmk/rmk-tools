import { put } from "@vercel/blob";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getBlobReadWriteToken } from "@/lib/blobEnv";
import { BLOB_INGEST_MAX_BYTES } from "@/lib/blobIngestLimits";
import { isToolUnlocked, TOOL_UNLOCK_COOKIE } from "@/lib/toolAuth";

export const runtime = "nodejs";

const UPLOAD_PATH_PREFIX = "flyer-uploads/";

function extFromFileName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  const ext = (m?.[1] || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return ext || "bin";
}

function inferContentType(file: File): string {
  const t = file.type?.trim();
  if (t && t !== "application/octet-stream") return t;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/**
 * Server-side upload to Vercel Blob (avoids browser PUT to blob.vercel-storage.com).
 * One file per request; keep under BLOB_INGEST_MAX_BYTES so the function request stays < ~4.5 MB.
 */
export async function POST(request: Request) {
  const token = getBlobReadWriteToken();
  if (!token) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not configured on the server." },
      { status: 503 },
    );
  }

  if (!process.env.PASSWORD?.trim()) {
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 503 });
  }

  const cookieStore = await cookies();
  if (!isToolUnlocked(cookieStore.get(TOOL_UNLOCK_COOKIE)?.value)) {
    return NextResponse.json({ error: "Unauthorized. Unlock the tool first." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Missing non-empty file field." }, { status: 400 });
  }

  if (file.size > BLOB_INGEST_MAX_BYTES) {
    return NextResponse.json(
      {
        error: `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB; max for this upload path is ${(BLOB_INGEST_MAX_BYTES / (1024 * 1024)).toFixed(1)} MB per request (Vercel request size limit). Compress or split the file.`,
      },
      { status: 413 },
    );
  }

  const pathname = `${UPLOAD_PATH_PREFIX}${crypto.randomUUID()}.${extFromFileName(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = inferContentType(file);

  try {
    const result = await put(pathname, buffer, {
      access: "public",
      token,
      contentType,
    });

    return NextResponse.json({
      url: result.url,
      name: file.name,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Blob put failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
