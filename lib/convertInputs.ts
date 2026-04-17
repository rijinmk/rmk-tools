import "server-only";

export const MAX_BYTES_PER_FILE = 30 * 1024 * 1024;
export const MAX_FILES = 25;

export const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export type SourceFile = {
  name: string;
  size: number;
  mime: string;
  buffer: Buffer;
};

export function isTrustedVercelBlobUrl(urlString: string): boolean {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  return h.endsWith(".public.blob.vercel-storage.com");
}

export function resolveMimeFromFile(file: File): string {
  if (ALLOWED_MIME.has(file.type)) {
    return file.type;
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return file.type || "application/octet-stream";
  }
}

export function resolveMimeFromName(fileName: string, contentTypeHeader: string | null): string {
  const declared = contentTypeHeader?.split(";")[0]?.trim();
  if (declared && ALLOWED_MIME.has(declared)) {
    return declared;
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function collectUploadedFiles(form: FormData): File[] {
  const fromMulti = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (fromMulti.length > 0) {
    return fromMulti;
  }

  const single = form.get("file");
  if (single instanceof File && single.size > 0) {
    return [single];
  }

  return [];
}

export function parseBlobFilesPayload(raw: unknown): { url: string; name: string }[] | null {
  if (!raw || typeof raw !== "object") return null;
  const blobFiles = (raw as { blobFiles?: unknown }).blobFiles;
  if (!Array.isArray(blobFiles) || blobFiles.length === 0) return null;
  const out: { url: string; name: string }[] = [];
  for (const item of blobFiles) {
    if (!item || typeof item !== "object") return null;
    const url = (item as { url?: unknown }).url;
    const name = (item as { name?: unknown }).name;
    if (typeof url !== "string" || typeof name !== "string" || !url.trim() || !name.trim()) {
      return null;
    }
    out.push({ url: url.trim(), name: name.trim() });
  }
  return out;
}

export async function prepareSourceFiles(req: Request): Promise<{
  files: SourceFile[];
  blobUrlsToDelete: string[];
}> {
  const ct = req.headers.get("content-type") || "";
  const blobUrlsToDelete: string[] = [];

  if (ct.includes("application/json")) {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new Error("Invalid JSON body.");
    }

    const entries = parseBlobFilesPayload(raw);
    if (!entries) {
      throw new Error('Invalid JSON: expected { "blobFiles": [{ "url": "https://…", "name": "file.pdf" }, …] }.');
    }

    if (entries.length > MAX_FILES) {
      throw new Error(`Too many files (max ${MAX_FILES}).`);
    }

    const files: SourceFile[] = [];
    for (const { url, name } of entries) {
      if (!isTrustedVercelBlobUrl(url)) {
        throw new Error(
          `URL not allowed for "${name}" — only https://*.public.blob.vercel-storage.com URLs from this app’s uploads are accepted.`,
        );
      }

      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        throw new Error(`Could not read "${name}" from blob storage (HTTP ${res.status}).`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_BYTES_PER_FILE) {
        throw new Error(`"${name}" is too large (max ${MAX_BYTES_PER_FILE} bytes).`);
      }

      const mime = resolveMimeFromName(name, res.headers.get("content-type"));
      if (!ALLOWED_MIME.has(mime)) {
        throw new Error(`Unsupported type for "${name}". Use PDF, PNG, JPEG, WebP, or GIF.`);
      }

      blobUrlsToDelete.push(url);
      files.push({ name, size: buffer.length, mime, buffer });
    }

    return { files, blobUrlsToDelete };
  }

  const form = await req.formData();
  const uploaded = collectUploadedFiles(form);
  if (uploaded.length === 0) {
    throw new Error("Upload at least one PDF or image (use the files field).");
  }

  if (uploaded.length > MAX_FILES) {
    throw new Error(`Too many files (max ${MAX_FILES}).`);
  }

  const files: SourceFile[] = [];
  for (const file of uploaded) {
    const mime = resolveMimeFromFile(file);
    if (!ALLOWED_MIME.has(mime)) {
      throw new Error(`Unsupported type for “${file.name}”. Use PDF, PNG, JPEG, WebP, or GIF.`);
    }
    if (file.size > MAX_BYTES_PER_FILE) {
      throw new Error(`“${file.name}” is too large (max 30 MB per file).`);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    files.push({ name: file.name, size: file.size, mime, buffer });
  }

  return { files, blobUrlsToDelete: [] };
}
