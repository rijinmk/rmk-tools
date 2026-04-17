/**
 * Max bytes per file for POST /api/blobs/ingest (single multipart hop to Vercel).
 * Stay under the ~4.5 MB serverless request cap including multipart boundaries.
 */
export const BLOB_INGEST_MAX_BYTES = 4_000_000;
