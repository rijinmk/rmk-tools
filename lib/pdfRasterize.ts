import "@/lib/polyfillPromiseWithResolvers";
import "@/lib/polyfillImageData";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";

import { convertLog, convertLogError } from "@/lib/convertPipelineLog";

const MAX_PAGES_DEFAULT = 25;
const MAX_EDGE_PX = 2200;

type CanvasAndContext = {
  canvas: Canvas;
  context: SKRSContext2D;
};

/**
 * Must match PDF.js expectations for Node — same backend as pdfjs-dist's NodeCanvasFactory
 * (@napi-rs/canvas). Using node-canvas here breaks drawImage on inline images.
 */
function createNodeCanvasFactory() {
  return {
    create(width: number, height: number): CanvasAndContext {
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      convertLog("pdf", "canvasFactory.create", { width: w, height: h });
      const canvas = createCanvas(w, h);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("@napi-rs/canvas: getContext('2d') returned null");
      }
      return { canvas, context };
    },
    reset(canvasAndContext: CanvasAndContext, width: number, height: number): CanvasAndContext {
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      canvasAndContext.canvas.width = w;
      canvasAndContext.canvas.height = h;
      const context = canvasAndContext.canvas.getContext("2d");
      if (!context) {
        throw new Error("@napi-rs/canvas: getContext('2d') returned null after reset");
      }
      return { canvas: canvasAndContext.canvas, context };
    },
    destroy(canvasAndContext: CanvasAndContext): void {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    },
  };
}

/**
 * Renders each PDF page to a PNG buffer (for Cloud Vision OCR).
 * Uses the legacy pdf.js build, which is what Mozilla recommends for Node.
 */
export async function renderPdfPagesToPngBuffers(
  pdfBuffer: Buffer,
  maxPages: number = MAX_PAGES_DEFAULT,
): Promise<Buffer[]> {
  convertLog("pdf", "rasterize.start", {
    bufferBytes: pdfBuffer.length,
    maxPages,
    canvasBackend: "@napi-rs/canvas",
  });

  type PdfjsLegacy = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  let pdfjs: PdfjsLegacy;
  try {
    convertLog("pdf", "import.pdfjs.legacy");
    pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLegacy;
  } catch (e) {
    convertLogError("pdf", e, { phase: "import.pdfjs.legacy" });
    throw e;
  }

  // Node uses a "fake worker" that dynamic-import()s this file; default "./pdf.worker.mjs"
  // breaks under Next/Vercel tracing. Use an absolute file URL (avoid require.resolve so webpack
  // does not try to bundle the worker) + `outputFileTracingIncludes` in next.config.ts.
  const workerDiskPath = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerDiskPath).href;
  convertLog("pdf", "workerSrc.set", { workerSrc: pdfjs.GlobalWorkerOptions.workerSrc });

  const data = new Uint8Array(pdfBuffer);
  convertLog("pdf", "getDocument.start", { dataBytes: data.length });

  let pdf: { numPages: number; getPage: (n: number) => Promise<unknown> };
  try {
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
    });
    pdf = (await loadingTask.promise) as typeof pdf;
  } catch (e) {
    convertLogError("pdf", e, { phase: "getDocument" });
    throw e;
  }

  const numPages = Math.min(pdf.numPages, maxPages);
  convertLog("pdf", "document.open", {
    numPagesTotal: pdf.numPages,
    numPagesToRender: numPages,
  });

  const pages: Buffer[] = [];
  const canvasFactory = createNodeCanvasFactory();

  for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
    convertLog("pdf", "page.start", { pageNum, of: numPages });
    let page: {
      getViewport: (p: { scale: number }) => { width: number; height: number };
      render: (ctx: {
        canvasContext: globalThis.CanvasRenderingContext2D;
        viewport: { width: number; height: number };
        canvasFactory: ReturnType<typeof createNodeCanvasFactory>;
      }) => { promise: Promise<void> };
    };
    try {
      page = (await pdf.getPage(pageNum)) as typeof page;
    } catch (e) {
      convertLogError("pdf", e, { phase: "getPage", pageNum });
      throw e;
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      MAX_EDGE_PX / baseViewport.width,
      MAX_EDGE_PX / baseViewport.height,
      2,
    );
    const viewport = page.getViewport({ scale });

    convertLog("pdf", "page.viewport", {
      pageNum,
      baseW: Math.round(baseViewport.width * 100) / 100,
      baseH: Math.round(baseViewport.height * 100) / 100,
      scale: Math.round(scale * 1000) / 1000,
      viewW: Math.round(viewport.width * 100) / 100,
      viewH: Math.round(viewport.height * 100) / 100,
    });

    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    try {
      convertLog("pdf", "page.render.start", { pageNum });
      await page
        .render({
          canvasContext: context as unknown as globalThis.CanvasRenderingContext2D,
          viewport,
          canvasFactory,
        })
        .promise;
      convertLog("pdf", "page.render.done", { pageNum });
    } catch (e) {
      convertLogError("pdf", e, { phase: "page.render", pageNum });
      canvasFactory.destroy({ canvas, context });
      throw e;
    }

    let png: Buffer;
    try {
      png = canvas.toBuffer("image/png");
      convertLog("pdf", "page.toBuffer", {
        pageNum,
        pngBytes: png.length,
      });
    } catch (e) {
      convertLogError("pdf", e, { phase: "page.toBuffer", pageNum });
      canvasFactory.destroy({ canvas, context });
      throw e;
    }

    canvasFactory.destroy({ canvas, context });
    pages.push(png);
    convertLog("pdf", "page.complete", { pageNum });
  }

  convertLog("pdf", "rasterize.done", { renderedPages: pages.length });
  return pages;
}
