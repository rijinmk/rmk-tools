import { NextResponse } from "next/server";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";

import {
  collectTextFromMessage,
  getAnthropicClient,
  getModel,
} from "@/lib/anthropic";
import { parseJsonFromModelText } from "@/lib/jsonFromModel";
import { buildOffersWorkbookBuffer, type OfferRow } from "@/lib/offerExcel";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES_PER_FILE = 30 * 1024 * 1024;
const MAX_FILES = 25;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function resolveMime(file: File): string {
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

function buildFileContentBlocks(base64: string, mime: string): ContentBlockParam[] {
  if (mime === "application/pdf") {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      },
      {
        type: "text",
        text: `Extract ALL readable text from this PDF as faithfully as possible.

Preserve reading order. Include headings, labels, captions, promo codes, phone numbers, emails, URLs, prices, dates, and any obvious tables. If something is clearly a table, represent it in a grid-like way using line breaks and spacing or tabs so the structure is obvious.

Do not summarize. Output plain extracted text only.`,
      },
    ];
  }

  const imageMime = mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: imageMime,
        data: base64,
      },
    },
    {
      type: "text",
      text: `Extract ALL readable text from this image as faithfully as possible.

Preserve reading order. Include headings, labels, captions, promo codes, phone numbers, emails, URLs, prices, dates, and any obvious tables. If something is clearly a table, represent it in a grid-like way using line breaks and spacing or tabs so the structure is obvious.

Do not summarize. Output plain extracted text only.`,
    },
  ];
}

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

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server is missing ANTHROPIC_API_KEY." },
        { status: 500 },
      );
    }

    const form = await req.formData();
    const files = collectUploadedFiles(form);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one PDF or image (use the files field)." },
        { status: 400 },
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Too many files (max ${MAX_FILES}).` },
        { status: 400 },
      );
    }

    for (const file of files) {
      const mime = resolveMime(file);
      if (!ALLOWED_MIME.has(mime)) {
        return NextResponse.json(
          {
            error: `Unsupported type for “${file.name}”. Use PDF, PNG, JPEG, WebP, or GIF.`,
          },
          { status: 400 },
        );
      }
      if (file.size > MAX_BYTES_PER_FILE) {
        return NextResponse.json(
          { error: `“${file.name}” is too large (max 30 MB per file).` },
          { status: 400 },
        );
      }
    }

    const anthropic = getAnthropicClient();
    const model = getModel();

    const extracted: { fileName: string; text: string }[] = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const mime = resolveMime(file);
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      const extractMessage = await anthropic.messages.create({
        model,
        max_tokens: 16384,
        messages: [
          {
            role: "user",
            content: buildFileContentBlocks(base64, mime),
          },
        ],
      });

      const text = collectTextFromMessage(extractMessage);
      if (!text) {
        return NextResponse.json(
          {
            error: `Claude returned no extracted text for “${file.name}”. Try a different file.`,
          },
          { status: 422 },
        );
      }

      extracted.push({ fileName: file.name, text });
    }

    const bundleText = extracted
      .map(
        (item, idx) =>
          `--- FILE ${idx + 1} / ${extracted.length}: ${item.fileName} ---\n${item.text}`,
      )
      .join("\n\n");

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

You will receive ${extracted.length} extracted text blocks in STRICT UPLOAD ORDER (FILE 1, FILE 2, ...). You MUST output EXACTLY ${extracted.length} rows in the SAME order — one row per uploaded file (even if a PDF contains multiple offers, still produce ONE combined row for that file).

Extracted texts:
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

    const sheetRaw = collectTextFromMessage(sheetMessage);
    let parsed: unknown;
    try {
      parsed = parseJsonFromModelText(sheetRaw);
    } catch {
      return NextResponse.json(
        {
          error:
            "Claude returned workbook data that could not be parsed as JSON. Try again with fewer files or clearer sources.",
        },
        { status: 422 },
      );
    }

    if (!isBatchPayload(parsed)) {
      return NextResponse.json(
        {
          error:
            "Claude returned JSON in an unexpected format. Try again or adjust the inputs.",
        },
        { status: 422 },
      );
    }

    if (parsed.rows.length !== extracted.length) {
      return NextResponse.json(
        {
          error: `Expected ${extracted.length} rows from Claude, got ${parsed.rows.length}. Try again.`,
        },
        { status: 422 },
      );
    }

    const workbookBuffer = buildOffersWorkbookBuffer(parsed.rows);
    const excelBase64 = workbookBuffer.toString("base64");
    const downloadName = `offer-flyers.xlsx`;

    return NextResponse.json({
      summary: parsed.summary,
      excelBase64,
      downloadName,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected error while converting.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
