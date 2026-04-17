import { put, type PutBlobResult } from "@vercel/blob";

/**
 * Public Blob stores require `access: "public"` on put; private stores require `"private"`.
 * Try public first (common default), then retry once for private-store errors.
 *
 * Note: older `@vercel/blob` typings only list `access: "public"`; private stores are still
 * supported at runtime — cast on the retry branch only.
 */
export async function putRespectingStoreAccess(
  pathname: string,
  buffer: Buffer,
  opts: { token: string; contentType: string },
): Promise<PutBlobResult> {
  try {
    return await put(pathname, buffer, {
      access: "public",
      token: opts.token,
      contentType: opts.contentType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/private store|Cannot use public access/i.test(msg)) {
      return await put(pathname, buffer, {
        access: "private",
        token: opts.token,
        contentType: opts.contentType,
      } as unknown as Parameters<typeof put>[2]);
    }
    throw e;
  }
}
