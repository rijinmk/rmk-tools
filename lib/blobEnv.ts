import "server-only";

/** Vercel injects `BLOB_READ_WRITE_TOKEN` when a Blob store is linked; some setups use the prefixed name. */
export function getBlobReadWriteToken(): string | undefined {
  const primary = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (primary) return primary;
  return process.env.VERCEL_BLOB_READ_WRITE_TOKEN?.trim();
}
