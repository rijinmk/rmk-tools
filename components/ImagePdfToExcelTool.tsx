"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Phase = "idle" | "uploading" | "success" | "error";

type VisionDebugPayload = {
  extractedAt: string;
  projectId: string;
  files: Array<{
    index: number;
    fileName: string;
    mimeType: string;
    source: string;
    pageCount: number;
    pages: Array<{ page: number; textLength: number; text: string }>;
    combinedText: string;
  }>;
};

type ConvertResponse = {
  summary: string;
  excelBase64: string;
  downloadName: string;
  visionDebug?: VisionDebugPayload;
};

const ACCEPT_ATTR =
  "application/pdf,image/png,image/jpeg,image/webp,image/gif,.pdf,.png,.jpg,.jpeg,.webp,.gif";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export function ImagePdfToExcelTool() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [excelBlobUrl, setExcelBlobUrl] = useState<string | null>(null);
  const [visionDebugJson, setVisionDebugJson] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isBusy = phase === "uploading";

  const revokeBlobUrl = useCallback(() => {
    setExcelBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const addToQueue = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (list.length === 0) return;

    setQueue((prev) => {
      const keys = new Set(prev.map(fileKey));
      const next = [...prev];
      for (const file of list) {
        const key = fileKey(file);
        if (!keys.has(key)) {
          keys.add(key);
          next.push(file);
        }
      }
      return next;
    });
    setError(null);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  const handleConvert = useCallback(async () => {
    if (queue.length === 0) return;

    setError(null);
    setSummary(null);
    setDownloadName(null);
    setVisionDebugJson(null);
    revokeBlobUrl();
    setPhase("uploading");

    const form = new FormData();
    for (const file of queue) {
      form.append("files", file);
    }

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        body: form,
      });

      const payload: unknown = await res.json().catch(() => null);
      const obj = payload as Partial<ConvertResponse> & {
        error?: string;
        visionDebug?: VisionDebugPayload;
      };

      if (!res.ok) {
        if (obj.visionDebug) {
          setVisionDebugJson(JSON.stringify(obj.visionDebug, null, 2));
        }
        const errObj = obj as { pipelineStep?: string; hint?: string };
        const parts = [
          obj?.error || `Request failed (${res.status}).`,
          errObj.pipelineStep ? `Step: ${errObj.pipelineStep}` : "",
          errObj.hint || "",
        ].filter(Boolean);
        throw new Error(parts.join("\n\n"));
      }

      if (
        typeof obj.summary !== "string" ||
        typeof obj.excelBase64 !== "string" ||
        typeof obj.downloadName !== "string"
      ) {
        throw new Error("Unexpected server response shape.");
      }

      if (obj.visionDebug) {
        setVisionDebugJson(JSON.stringify(obj.visionDebug, null, 2));
      }

      const blob = base64ToBlob(
        obj.excelBase64,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      const url = URL.createObjectURL(blob);

      revokeBlobUrl();
      setExcelBlobUrl(url);
      setSummary(obj.summary);
      setDownloadName(obj.downloadName);
      setPhase("success");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setError(message);
      setPhase("error");
    }
  }, [queue, revokeBlobUrl]);

  const onPickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      e.target.value = "";
      if (!list || list.length === 0) return;
      addToQueue(list);
    },
    [addToQueue],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const list = e.dataTransfer.files;
      if (!list || list.length === 0) return;
      addToQueue(list);
    },
    [addToQueue],
  );

  const hint = useMemo(
    () =>
      `Add multiple PDFs and/or images (PNG, JPEG, WebP, GIF). Up to ${25} files, 30 MB each. You will get one .xlsx with one row per file.`,
    [],
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div
        className={[
          "rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-8 transition",
          isDragging ? "border-[color:var(--accent)] ring-2 ring-[color:var(--accent)]/30" : "",
          isBusy ? "opacity-70" : "",
        ].join(" ")}
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <div className="flex flex-col items-center text-center">
          <p className="text-sm text-[color:var(--muted)]">{hint}</p>
          <p className="mt-3 text-lg font-medium">Drag and drop files here</p>
          <p className="mt-1 text-sm text-[color:var(--muted)]">or</p>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            className="hidden"
            onChange={onInputChange}
            disabled={isBusy}
          />

          <button
            type="button"
            onClick={onPickFile}
            disabled={isBusy}
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Choose files
          </button>
        </div>
      </div>

      {queue.length > 0 ? (
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Queued files ({queue.length})</p>
              <p className="mt-1 text-xs text-[color:var(--muted)]">
                Order is preserved — row 1 matches the first file in this list.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={clearQueue}
                disabled={isBusy}
                className="rounded-xl border border-[color:var(--border)] px-3 py-2 text-sm font-semibold text-[color:var(--text)] transition hover:bg-[color:var(--bg)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={isBusy}
                className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate Excel
              </button>
            </div>
          </div>

          <ul className="mt-4 divide-y divide-[color:var(--border)] rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)]">
            {queue.map((file, index) => (
              <li
                key={fileKey(file)}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-[color:var(--muted)]">
                    #{index + 1}
                  </p>
                  <p className="truncate">{file.name}</p>
                  <p className="text-xs text-[color:var(--muted)]">{formatBytes(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFromQueue(index)}
                  disabled={isBusy}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[color:var(--muted)] transition hover:bg-[color:var(--surface)] hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isBusy ? (
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
          <div className="flex items-start gap-4">
            <div
              className="mt-1 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)]"
              aria-hidden
            />
            <div>
              <p className="font-medium">Running Vision OCR and Claude</p>
              <p className="mt-1 text-sm text-[color:var(--muted)]">
                Google Cloud Vision is extracting text from {queue.length} file
                {queue.length === 1 ? "" : "s"} (PDFs are rasterized page-by-page), then Claude
                builds the bilingual workbook. This can take several minutes for many pages.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "error" && error ? (
        <div
          className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-[color:var(--danger)]"
          role="alert"
        >
          <p className="font-semibold">Could not convert</p>
          <p className="mt-2 whitespace-pre-wrap text-[color:var(--muted)]">{error}</p>
          {visionDebugJson ? (
            <details className="mt-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] p-3 text-[color:var(--text)]">
              <summary className="cursor-pointer text-xs font-semibold text-[color:var(--muted)]">
                Vision OCR (JSON)
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[color:var(--muted)]">
                {visionDebugJson}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

      {phase === "success" && summary ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
            <p className="text-sm font-semibold text-[color:var(--muted)]">Result</p>

            <div className="prose prose-invert prose-sm mt-4 max-w-none">
              <ReactMarkdown>{summary}</ReactMarkdown>
            </div>

            {downloadName && excelBlobUrl ? (
              <div className="mt-6 flex flex-col gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                    Attachment
                  </p>
                  <p className="mt-1 truncate font-mono text-sm">{downloadName}</p>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                    Microsoft Excel workbook (.xlsx)
                  </p>
                </div>

                <a
                  href={excelBlobUrl}
                  download={downloadName}
                  className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-hover)]"
                >
                  Download Excel
                </a>
              </div>
            ) : null}

            {visionDebugJson ? (
              <details className="mt-6 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] p-4">
                <summary className="cursor-pointer text-sm font-semibold text-[color:var(--muted)]">
                  Vision OCR (JSON) — verify extraction
                </summary>
                <p className="mt-2 text-xs text-[color:var(--muted)]">
                  Same structure is printed to the server console as{" "}
                  <code className="rounded bg-[color:var(--surface)] px-1">[vision] OCR complete</code>.
                </p>
                <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[color:var(--text)]">
                  {visionDebugJson}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
