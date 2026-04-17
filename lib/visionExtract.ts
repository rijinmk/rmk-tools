import { ImageAnnotatorClient } from "@google-cloud/vision";
import type { protos } from "@google-cloud/vision";

import { convertLog, convertLogError } from "@/lib/convertPipelineLog";
import { getVisionServiceAccountCredentials } from "@/lib/visionCredentials";
import { renderPdfPagesToPngBuffers } from "@/lib/pdfRasterize";

let clientSingleton: ImageAnnotatorClient | null = null;

function getVisionClient(): ImageAnnotatorClient {
  if (!clientSingleton) {
    clientSingleton = new ImageAnnotatorClient({
      credentials: getVisionServiceAccountCredentials() as object,
    });
  }
  return clientSingleton;
}

function textFromAnnotation(
  result: protos.google.cloud.vision.v1.IAnnotateImageResponse,
): string {
  const full = result.fullTextAnnotation?.text?.trim();
  if (full) return full;
  const first = result.textAnnotations?.[0]?.description?.trim();
  return first ?? "";
}

export type VisionPageExtraction = {
  page: number;
  text: string;
  textLength: number;
};

export type VisionFileExtractionLog = {
  index: number;
  fileName: string;
  mimeType: string;
  source: "image" | "pdf_pages";
  pages: VisionPageExtraction[];
  combinedText: string;
};

export async function extractTextWithVision(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  fileIndex: number,
): Promise<VisionFileExtractionLog> {
  convertLog("vision", "extract.start", {
    fileIndex,
    fileName,
    mimeType,
    bufferBytes: buffer.length,
  });

  const client = getVisionClient();

  if (mimeType === "application/pdf") {
    convertLog("vision", "pdf.rasterize.before", { fileName, fileIndex });
    let pngPages: Buffer[];
    try {
      pngPages = await renderPdfPagesToPngBuffers(buffer);
    } catch (e) {
      convertLogError("vision", e, {
        fileName,
        fileIndex,
        phase: "renderPdfPagesToPngBuffers",
      });
      throw e;
    }
    convertLog("vision", "pdf.rasterize.after", {
      fileName,
      pageImages: pngPages.length,
    });

    const pages: VisionPageExtraction[] = [];

    for (let i = 0; i < pngPages.length; i += 1) {
      convertLog("vision", "documentTextDetection.request", {
        fileName,
        pdfPage: i + 1,
        imageBytes: pngPages[i].length,
      });
      let responses: protos.google.cloud.vision.v1.IAnnotateImageResponse[];
      try {
        responses = await client.documentTextDetection({
          image: { content: pngPages[i] },
        });
      } catch (e) {
        convertLogError("vision", e, {
          fileName,
          pdfPage: i + 1,
          phase: "documentTextDetection",
        });
        throw e;
      }
      const result = responses[0];
      if (!result) {
        throw new Error(`Vision returned an empty response for PDF page ${i + 1} of “${fileName}”.`);
      }
      const text = textFromAnnotation(result);
      convertLog("vision", "documentTextDetection.response", {
        fileName,
        pdfPage: i + 1,
        textLength: text.length,
      });
      pages.push({
        page: i + 1,
        text,
        textLength: text.length,
      });
    }

    const combinedText = pages
      .map((p) => `--- OCR Page ${p.page} ---\n\n${p.text}`)
      .join("\n\n")
      .trim();

    convertLog("vision", "extract.done", {
      fileName,
      source: "pdf_pages",
      pageCount: pages.length,
      combinedTextLength: combinedText.length,
    });

    return {
      index: fileIndex,
      fileName,
      mimeType,
      source: "pdf_pages",
      pages,
      combinedText,
    };
  }

  convertLog("vision", "documentTextDetection.request", {
    fileName,
    kind: "image",
    imageBytes: buffer.length,
  });
  let responses: protos.google.cloud.vision.v1.IAnnotateImageResponse[];
  try {
    responses = await client.documentTextDetection({
      image: { content: buffer },
    });
  } catch (e) {
    convertLogError("vision", e, { fileName, phase: "documentTextDetection.image" });
    throw e;
  }
  const result = responses[0];
  if (!result) {
    throw new Error(`Vision returned an empty response for image “${fileName}”.`);
  }
  const text = textFromAnnotation(result);
  convertLog("vision", "documentTextDetection.response", {
    fileName,
    kind: "image",
    textLength: text.length,
  });
  const pages: VisionPageExtraction[] = [
    { page: 1, text, textLength: text.length },
  ];

  convertLog("vision", "extract.done", {
    fileName,
    source: "image",
    combinedTextLength: text.length,
  });

  return {
    index: fileIndex,
    fileName,
    mimeType,
    source: "image",
    pages,
    combinedText: text,
  };
}
