"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import { BLOB_INGEST_MAX_BYTES } from "@/lib/blobIngestLimits";

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

type PipelineStage = "ocr" | "claude" | "excel";

const QUEUE_EXIT_MS = 320;
const QUEUE_ENTER_TRANSITION = "duration-300 ease-out";

/** Stay under Vercel’s ~4.5 MB multipart cap (multipart boundaries add a lot of overhead). */
const MULTIPART_SAFE_TOTAL_BYTES = 2_500_000;

/** Warn in the queue UI above this size when Blob is not available. */
const HOSTED_REQUEST_WARNING_BYTES = 2_500_000;

function pipelineStageFromElapsed(ms: number): PipelineStage {
  if (ms < 22_000) return "ocr";
  if (ms < 55_000) return "claude";
  return "excel";
}

export function ImagePdfToExcelTool() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prevQueueLen = useRef(0);
  const convertFilesRef = useRef<File[]>([]);
  const [queue, setQueue] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [excelBlobUrl, setExcelBlobUrl] = useState<string | null>(null);
  const [visionDebugJson, setVisionDebugJson] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [queueExiting, setQueueExiting] = useState(false);
  const [queueCardVisible, setQueueCardVisible] = useState(false);
  const [runPanelVisible, setRunPanelVisible] = useState(false);
  const [uploadTick, setUploadTick] = useState(0);
  const [convertFileCount, setConvertFileCount] = useState(0);
  const [blobDirectUpload, setBlobDirectUpload] = useState(false);

  const isBusy = phase === "uploading";

  useEffect(() => {
    const load = () => {
      void fetch("/api/blobs/ready", { credentials: "include" })
        .then((r) => r.json() as Promise<{ clientUpload?: boolean }>)
        .then((d) => setBlobDirectUpload(Boolean(d.clientUpload)))
        .catch(() => setBlobDirectUpload(false));
    };
    load();
    window.addEventListener("rmk-tools-session", load);
    return () => window.removeEventListener("rmk-tools-session", load);
  }, []);

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

  const performConvert = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setError(null);
      setSummary(null);
      setDownloadName(null);
      setVisionDebugJson(null);
      revokeBlobUrl();
      setPhase("uploading");

      let res: Response;
      let usedBlobUploadPath = false;
      try {
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        const readyRes = await fetch("/api/blobs/ready", { credentials: "include" });
        const readyJson = (await readyRes.json()) as {
          clientUpload?: boolean;
          toolUnlocked?: boolean;
          blobTokenSet?: boolean;
        };
        const blobOk = Boolean(readyJson.clientUpload);
        const toolUnlocked = readyJson.toolUnlocked !== false;
        const blobTokenSet = Boolean(readyJson.blobTokenSet);

        if (totalBytes > MULTIPART_SAFE_TOTAL_BYTES && !blobOk) {
          const sizeMb = (totalBytes / (1024 * 1024)).toFixed(1);
          if (!toolUnlocked) {
            throw new Error(
              `This batch is about ${sizeMb} MB. Unlock the tool again (password), then retry so the app can upload each file to Blob via the server (avoids the ~4.5 MB single-request cap).`,
            );
          }
          if (!blobTokenSet) {
            throw new Error(
              [
                `This batch is about ${sizeMb} MB. Vercel blocks the normal upload path over ~4.5 MB.`,
                "",
                "Fix (one-time): Vercel → your project → Storage → Blob → create or connect a store linked to this project. That injects BLOB_READ_WRITE_TOKEN (or VERCEL_BLOB_READ_WRITE_TOKEN) for Production — check Settings → Environment Variables after linking.",
                "Then: Deployments → Redeploy. Open this tool, enter the password again, and run Generate.",
                "",
                "Local: add BLOB_READ_WRITE_TOKEN to .env (vercel env pull) or run npm run dev without deploying.",
              ].join("\n"),
            );
          }
        }

        if (blobOk) {
          usedBlobUploadPath = true;
          const oversized = files.filter((f) => f.size > BLOB_INGEST_MAX_BYTES);
          if (oversized.length > 0) {
            const maxMb = (BLOB_INGEST_MAX_BYTES / (1024 * 1024)).toFixed(1);
            throw new Error(
              [
                `These files exceed ${maxMb} MB each (Vercel request limit for server → Blob upload):`,
                ...oversized.map((f) => `• ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)} MB)`),
                "",
                "Compress PDFs/images, split large PDFs, or run `npm run dev` locally where this limit does not apply.",
              ].join("\n"),
            );
          }

          const blobFiles: { url: string; name: string }[] = [];
          for (const file of files) {
            const fd = new FormData();
            fd.append("file", file);
            const up = await fetch("/api/blobs/ingest", {
              method: "POST",
              body: fd,
              credentials: "include",
            });
            const raw = await up.text();
            let parsed: unknown = null;
            try {
              parsed = raw.trim() ? JSON.parse(raw) : null;
            } catch {
              parsed = null;
            }
            const row =
              parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? (parsed as { url?: unknown; name?: unknown; error?: unknown })
                : null;
            if (!up.ok || typeof row?.url !== "string") {
              const err =
                typeof row?.error === "string"
                  ? row.error
                  : `Blob ingest failed for “${file.name}” (${up.status}).`;
              throw new Error(err);
            }
            blobFiles.push({ url: row.url, name: typeof row.name === "string" ? row.name : file.name });
          }
          res = await fetch("/api/convert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ blobFiles }),
            credentials: "include",
          });
        } else {
          const form = new FormData();
          for (const file of files) {
            form.append("files", file);
          }
          res = await fetch("/api/convert", {
            method: "POST",
            body: form,
            credentials: "include",
          });
        }

        const rawText = await res.text();
        let payload: unknown = null;
        if (rawText.trim()) {
          try {
            payload = JSON.parse(rawText) as unknown;
          } catch {
            payload = null;
          }
        }

        const isRecord = (v: unknown): v is Record<string, unknown> =>
          typeof v === "object" && v !== null && !Array.isArray(v);

        const obj = isRecord(payload)
          ? (payload as Partial<ConvertResponse> & {
              error?: string;
              visionDebug?: VisionDebugPayload;
              pipelineStep?: string;
              hint?: string;
            })
          : null;

        if (!obj) {
          const preview = rawText.replace(/\s+/g, " ").trim().slice(0, 280);
          const hint =
            res.status === 413
              ? usedBlobUploadPath
                ? "Request was still too large (unexpected)."
                : "Payload too large for this host (~4.5 MB). In Vercel: add a Blob store and BLOB_READ_WRITE_TOKEN so each file can be sent to /api/blobs/ingest then Blob, or use fewer/smaller files / npm run dev locally."
              : res.status === 504 || res.status === 502
                ? "Gateway timeout or bad gateway — conversion may exceed serverless limits; check Vercel function logs and maxDuration."
                : "Often HTML from a proxy or an empty body when JSON was expected.";
          throw new Error(
            [
              `Invalid or non-JSON response (${res.status} ${res.statusText || ""}).`,
              hint,
              preview ? `Body preview: ${preview}` : "Body: (empty)",
            ].join("\n\n"),
          );
        }

        if (!res.ok) {
          const vd = obj.visionDebug;
          if (vd) {
            setVisionDebugJson(JSON.stringify(vd, null, 2));
          }
          const parts = [
            obj.error || `Request failed (${res.status}).`,
            obj.pipelineStep ? `Step: ${obj.pipelineStep}` : "",
            obj.hint || "",
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
    },
    [revokeBlobUrl],
  );

  const requestGenerate = useCallback(() => {
    if (queue.length === 0 || isBusy || queueExiting) return;
    setConvertFileCount(queue.length);
    convertFilesRef.current = [...queue];
    setQueueExiting(true);
  }, [queue, isBusy, queueExiting]);

  useEffect(() => {
    if (!queueExiting) return;
    const t = window.setTimeout(() => {
      setQueueExiting(false);
      void performConvert(convertFilesRef.current);
    }, QUEUE_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [queueExiting, performConvert]);

  useEffect(() => {
    const prev = prevQueueLen.current;
    prevQueueLen.current = queue.length;

    if (queue.length === 0) {
      setQueueCardVisible(false);
      return;
    }

    if (prev === 0 && queue.length > 0) {
      setQueueCardVisible(false);
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setQueueCardVisible(true));
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [queue.length]);

  useEffect(() => {
    if (phase !== "uploading") {
      setRunPanelVisible(false);
      return;
    }
    setRunPanelVisible(false);
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setRunPanelVisible(true));
    });
    return () => window.cancelAnimationFrame(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "uploading") {
      setUploadTick(0);
      return;
    }
    setUploadTick(0);
    const id = window.setInterval(() => setUploadTick((n) => n + 1), 400);
    return () => window.clearInterval(id);
  }, [phase]);

  const uploadElapsedMs = phase === "uploading" ? uploadTick * 400 : 0;
  const activePipelineStage = pipelineStageFromElapsed(uploadElapsedMs);

  const pipelineCopy = useMemo(() => {
    const n = convertFileCount;
    const fileWord = n === 1 ? "file" : "files";
    return {
      ocr: `Google Cloud Vision is running OCR on ${n} ${fileWord}. Each PDF page is rasterized in Node and sent to Vision as an image; PNG, JPEG, WebP, and GIF are sent directly. Text and layout cues are gathered for every page before the pipeline moves on.`,
      claude: `Anthropic Claude reads the combined Vision output and produces structured bilingual rows (Arabic and English), one logical row per source ${fileWord} in the same order as your queue. It normalizes headers, merges wrapped lines where appropriate, and prepares cell-ready values for Excel.`,
      excel: `ExcelJS is generating the downloadable .xlsx: worksheet layout, column widths, wrapped text, zebra striping, and estimated row heights so the workbook opens cleanly in Microsoft Excel or compatible apps.`,
    } satisfies Record<PipelineStage, string>;
  }, [convertFileCount]);

  const queueActionsDisabled = isBusy || queueExiting;
  const showDropzone = queue.length === 0 && !isBusy;
  const showQueuePanel = queue.length > 0 && (queueExiting || !isBusy);
  const showAddMore = queue.length > 0 && !isBusy && !queueExiting;

  const stepVisual = (step: PipelineStage) => {
    const order: PipelineStage[] = ["ocr", "claude", "excel"];
    const activeIdx = order.indexOf(activePipelineStage);
    const idx = order.indexOf(step);
    if (idx < activeIdx) return "done" as const;
    if (idx === activeIdx) return "active" as const;
    return "pending" as const;
  };

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
      `Add multiple PDFs and/or images (PNG, JPEG, WebP, GIF). Up to ${25} files, 30 MB each. One .xlsx row per file. On Vercel, set BLOB_READ_WRITE_TOKEN so each file uploads to Blob through the app (per-file cap about 4 MB on serverless; otherwise the multipart path is capped near ~4.5 MB).`,
    [],
  );

  const queueTotalBytes = useMemo(
    () => queue.reduce((sum, file) => sum + file.size, 0),
    [queue],
  );

  const queueLikelyTooLargeForVercel =
    queueTotalBytes > HOSTED_REQUEST_WARNING_BYTES && !blobDirectUpload;

  const queueCardMotion = queueExiting
    ? "pointer-events-none opacity-0 translate-y-2 scale-[0.99]"
    : queueCardVisible
      ? "opacity-100 translate-y-0 scale-100"
      : "opacity-0 translate-y-4 scale-[0.98]";

  const runPanelMotion = runPanelVisible
    ? "opacity-100 translate-y-0"
    : "opacity-0 translate-y-4";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={onInputChange}
        disabled={isBusy}
      />

      {showDropzone ? (
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
      ) : null}

      {showAddMore ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onPickFile}
            disabled={queueActionsDisabled}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--text)] transition hover:bg-[color:var(--bg)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add more files
          </button>
        </div>
      ) : null}

      {showQueuePanel ? (
        <div
          className={[
            "rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 transition-all will-change-transform",
            QUEUE_ENTER_TRANSITION,
            queueCardMotion,
          ].join(" ")}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Queued files ({queue.length})</p>
              <p className="mt-1 text-xs text-[color:var(--muted)]">
                Order is preserved — row 1 matches the first file in this list.
              </p>
              {queueLikelyTooLargeForVercel ? (
                <p className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100/95">
                  Total {formatBytes(queueTotalBytes)}: without Blob configured, many hosts return{" "}
                  <strong className="font-semibold">413</strong> (~4.5 MB request cap). Add{" "}
                  <code className="rounded bg-black/20 px-1">BLOB_READ_WRITE_TOKEN</code> on the server
                  (per-file ingest ~4 MB), split runs, or use{" "}
                  <code className="rounded bg-black/20 px-1">npm run dev</code> locally.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={clearQueue}
                disabled={queueActionsDisabled}
                className="rounded-xl border border-[color:var(--border)] px-3 py-2 text-sm font-semibold text-[color:var(--text)] transition hover:bg-[color:var(--bg)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={requestGenerate}
                disabled={queueActionsDisabled}
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
                  disabled={queueActionsDisabled}
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
        <div
          className={[
            "rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 transition-all duration-300 ease-out will-change-transform",
            runPanelMotion,
          ].join(" ")}
        >
          <div className="flex items-start gap-4">
            <div
              className="mt-1 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)]"
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-4">
              <div>
                <p className="font-medium">Running conversion</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  Large batches and long PDFs can take several minutes. The steps below mirror the
                  server pipeline; the highlighted stage advances while the request is in flight.
                </p>
              </div>

              <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch sm:gap-3">
                {(
                  [
                    { id: "ocr" as const, title: "1 · OCR", sub: "Google Cloud Vision" },
                    { id: "claude" as const, title: "2 · Claude", sub: "Structured bilingual rows" },
                    { id: "excel" as const, title: "3 · Excel", sub: "Workbook generation" },
                  ] as const
                ).map(({ id, title, sub }) => {
                  const vis = stepVisual(id);
                  return (
                    <li
                      key={id}
                      className={[
                        "flex min-w-0 flex-1 flex-col rounded-xl border px-3 py-2.5 text-left text-xs transition-colors",
                        vis === "active"
                          ? "border-[color:var(--accent)]/50 bg-[color:var(--accent)]/10 ring-1 ring-[color:var(--accent)]/35"
                          : vis === "done"
                            ? "border-emerald-500/25 bg-emerald-500/5"
                            : "border-[color:var(--border)] bg-[color:var(--bg)] opacity-60",
                      ].join(" ")}
                    >
                      <span className="font-semibold text-[color:var(--text)]">{title}</span>
                      <span className="mt-0.5 text-[color:var(--muted)]">{sub}</span>
                      {vis === "active" ? (
                        <span className="mt-1.5 inline-flex items-center gap-1 font-medium text-[color:var(--accent)]">
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--accent)]" />
                          In progress
                        </span>
                      ) : null}
                      {vis === "done" ? (
                        <span className="mt-1.5 font-medium text-emerald-400/90">Complete</span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>

              <p
                key={activePipelineStage}
                className="text-sm leading-relaxed text-[color:var(--muted)] motion-safe:animate-rmk-fade-in"
              >
                {pipelineCopy[activePipelineStage]}
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
