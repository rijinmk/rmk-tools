import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { convertLog, convertLogError } from "@/lib/convertPipelineLog";
import { getBlobReadWriteToken } from "@/lib/blobEnv";
import { prepareSourceFiles } from "@/lib/convertInputs";
import { isToolUnlocked, TOOL_UNLOCK_COOKIE } from "@/lib/toolAuth";
import {
  collectTextFromMessage,
  getAnthropicClient,
  getModel,
} from "@/lib/anthropic";
import { parseJsonFromModelText } from "@/lib/jsonFromModel";
import { buildOffersWorkbookBuffer, type OfferRow } from "@/lib/offerExcel";
import { getVisionServiceAccountCredentials } from "@/lib/visionCredentials";
import {
  extractTextWithVision,
  type VisionFileExtractionLog,
} from "@/lib/visionExtract";

export const runtime = "nodejs";
export const maxDuration = 300;

function isOfferRow(v: unknown): v is OfferRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.englishTitle === "string" &&
    typeof r.arabicTitle === "string" &&
    typeof r.englishDescription === "string" &&
    typeof r.arabicDescription === "string"
  );
}

function isBatchPayload(
  v: unknown,
): v is { summary: string; rows: OfferRow[] } {
  if (!v || typeof v !== "object") return false;
  const obj = v as { summary?: unknown; rows?: unknown };
  if (typeof obj.summary !== "string" || !Array.isArray(obj.rows)) return false;
  return obj.rows.every((row) => isOfferRow(row));
}

export async function POST(req: Request) {
  let pipelineStep = "start";
  try {
    convertLog("api", "request.received", {});
    pipelineStep = "check-tool-unlock";
    if (!process.env.PASSWORD?.trim()) {
      return NextResponse.json(
        { error: "Server is missing PASSWORD. Set it in your environment file." },
        { status: 503 },
      );
    }
    const cookieStore = await cookies();
    if (!isToolUnlocked(cookieStore.get(TOOL_UNLOCK_COOKIE)?.value)) {
      return NextResponse.json(
        {
          error: "Unauthorized. Enter the tool password on the tool page first.",
          pipelineStep,
        },
        { status: 401 },
      );
    }

    pipelineStep = "check-anthropic-key";
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server is missing ANTHROPIC_API_KEY." },
        { status: 500 },
      );
    }

    pipelineStep = "check-vision-credentials";
    let visionCredsJson: Record<string, string>;
    try {
      visionCredsJson = getVisionServiceAccountCredentials();
      convertLog("api", "vision.credentials.ok", {
        projectId: visionCredsJson.project_id,
      });
    } catch (e) {
      convertLogError("api", e, { pipelineStep });
      const msg = e instanceof Error ? e.message : "Invalid Vision credentials.";
      return NextResponse.json({ error: msg, pipelineStep }, { status: 500 });
    }

    pipelineStep = "parse-input";
    let files!: Awaited<ReturnType<typeof prepareSourceFiles>>["files"];
    let blobUrlsToDelete: string[] = [];
    try {
      const prepared = await prepareSourceFiles(req, {
        blobReadWriteToken: getBlobReadWriteToken(),
      });
      files = prepared.files;
      blobUrlsToDelete = prepared.blobUrlsToDelete;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request body.";
      return NextResponse.json({ error: msg, pipelineStep }, { status: 400 });
    }

    convertLog("api", "files.accepted", {
      count: files.length,
      names: files.map((f) => f.name).join("|"),
      viaBlob: blobUrlsToDelete.length > 0,
    });

    const visionLogs: VisionFileExtractionLog[] = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const mime = file.mime;
      pipelineStep = `vision:file-${i + 1}-of-${files.length}:${file.name}`;
      convertLog("api", "vision.file.start", {
        index: i,
        fileName: file.name,
        mime,
        sizeBytes: file.size,
      });
      const log = await extractTextWithVision(file.buffer, mime, file.name, i);
      visionLogs.push(log);
      convertLog("api", "vision.file.done", { index: i, fileName: file.name });
    }

    const visionPayload = {
      extractedAt: new Date().toISOString(),
      projectId: visionCredsJson.project_id,
      files: visionLogs.map((entry) => ({
        index: entry.index,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        source: entry.source,
        pageCount: entry.pages.length,
        pages: entry.pages.map((p) => ({
          page: p.page,
          textLength: p.textLength,
          text: p.text,
        })),
        combinedText: entry.combinedText,
      })),
    };

    console.log(`[vision] OCR complete — ${JSON.stringify(visionPayload, null, 2)}`);
    convertLog("api", "vision.all.complete", {
      fileCount: visionLogs.length,
    });

    const extracted = visionLogs.map((v) => ({
      fileName: v.fileName,
      text: v.combinedText,
    }));

    for (const item of extracted) {
      if (!item.text?.trim()) {
        return NextResponse.json(
          {
            error: `Vision OCR returned no text for “${item.fileName}”.`,
            visionDebug: visionPayload,
          },
          { status: 422 },
        );
      }
    }

    pipelineStep = "claude:init-client";
    const anthropic = getAnthropicClient();
    const model = getModel();
    convertLog("claude", "client.ready", { model });

    const bundleText = extracted
      .map(
        (item, idx) =>
          `--- FILE ${idx + 1} / ${extracted.length}: ${item.fileName} ---\n${item.text}`,
      )
      .join("\n\n");

    pipelineStep = "claude:messages.create";
    convertLog("claude", "messages.create.start", {
      maxTokens: 20000,
      bundleChars: bundleText.length,
    });
    const sheetMessage = await anthropic.messages.create({
      model,
      max_tokens: 20000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are preparing ONE Excel-style dataset for hotel / travel / corporate offer flyers.

You will receive ${extracted.length} OCR text blocks in STRICT UPLOAD ORDER (FILE 1, FILE 2, ...). You MUST output EXACTLY ${extracted.length} rows in the SAME order — one row per uploaded file (even if a PDF contains multiple offers, still produce ONE combined row for that file).

OCR / extracted texts:
${bundleText}

Return ONLY valid JSON (no markdown fences) using EXACTLY this shape:
{
  "summary": "Markdown for the user: short overview of what was processed, notable assumptions, and anything important about the workbook.",
  "rows": [
    {
      "englishTitle": "Emoji + short English title (example: 🏖️ Centara Mirage Family Daycation)",
      "arabicTitle": "Same emoji + concise Arabic title (example: 🏖️ سنترا ميراج - إجازة عائلية يومية)",
      "englishDescription": "Multi-line English marketing copy summarizing the offer, then a blank line, then a line 'Terms & Conditions', then bullet lines starting with '- ' including prices, validity, fees, contacts, URLs, promo/booking codes when present.",
      "arabicDescription": "Multi-line Modern Standard Arabic translation mirroring the English structure: include a blank line, then 'الشروط والأحكام', then '-' bullets. Keep phone numbers/emails/URLs readable; you may reorder digits in phone numbers to Arabic reading style when appropriate."
    }
  ]
}

Hard rules:
- rows.length MUST be ${extracted.length}.
- Titles must include exactly one leading emoji that fits the offer.
- englishDescription and arabicDescription should be plain text with newline breaks (not HTML).
- If the source is English-only, still write high-quality Arabic in arabicTitle and arabicDescription.
- If the source already contains Arabic, merge it naturally but keep the bilingual columns complete.`,
            },
          ],
        },
      ],
    });
    convertLog("claude", "messages.create.done", {
      stopReason: sheetMessage.stop_reason,
      outputBlocks: sheetMessage.content.length,
    });

    const sheetRaw = collectTextFromMessage(sheetMessage);
    let parsed: unknown;
    try {
      parsed = parseJsonFromModelText(sheetRaw);
    } catch {
      return NextResponse.json(
        {
          error:
            "Claude returned workbook data that could not be parsed as JSON. Try again with fewer files or clearer sources.",
          visionDebug: visionPayload,
        },
        { status: 422 },
      );
    }

    if (!isBatchPayload(parsed)) {
      return NextResponse.json(
        {
          error:
            "Claude returned JSON in an unexpected format. Try again or adjust the inputs.",
          visionDebug: visionPayload,
        },
        { status: 422 },
      );
    }

    if (parsed.rows.length !== extracted.length) {
      return NextResponse.json(
        {
          error: `Expected ${extracted.length} rows from Claude, got ${parsed.rows.length}. Try again.`,
          visionDebug: visionPayload,
        },
        { status: 422 },
      );
    }

    pipelineStep = "excel:build-workbook";
    convertLog("excel", "build.start", { rows: parsed.rows.length });
    const workbookBuffer = await buildOffersWorkbookBuffer(parsed.rows);
    convertLog("excel", "build.done", { xlsxBytes: workbookBuffer.length });
    const excelBase64 = workbookBuffer.toString("base64");
    const downloadName = `offer-flyers.xlsx`;

    pipelineStep = "done";
    convertLog("api", "request.success", { downloadName });

    const blobRw = getBlobReadWriteToken();
    if (blobUrlsToDelete.length > 0 && blobRw) {
      pipelineStep = "blob:cleanup";
      try {
        const { del } = await import("@vercel/blob");
        const token = blobRw;
        await Promise.all(
          blobUrlsToDelete.map((url) =>
            del(url, { token }).catch(() => {
              /* best-effort cleanup */
            }),
          ),
        );
        convertLog("api", "blob.cleanup.done", { count: blobUrlsToDelete.length });
      } catch (cleanupErr) {
        convertLogError("api", cleanupErr, { pipelineStep });
      }
    }

    return NextResponse.json({
      summary: parsed.summary,
      excelBase64,
      downloadName,
      visionDebug: visionPayload,
    });
  } catch (err) {
    convertLogError("api", err, { pipelineStep });
    const message =
      err instanceof Error ? err.message : "Unexpected error while converting.";
    return NextResponse.json(
      {
        error: message,
        pipelineStep,
        hint: "Open the terminal where `npm run dev` is running and search for lines starting with [rmk-tools:convert].",
      },
      { status: 500 },
    );
  }
}
