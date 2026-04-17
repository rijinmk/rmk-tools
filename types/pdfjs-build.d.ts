type PdfCanvasFactory = {
  create(width: number, height: number): {
    canvas: unknown;
    context: CanvasRenderingContext2D;
  };
  reset(
    canvasAndContext: { canvas: unknown; context: CanvasRenderingContext2D },
    width: number,
    height: number,
  ): { canvas: unknown; context: CanvasRenderingContext2D };
  destroy(canvasAndContext: { canvas: unknown; context: CanvasRenderingContext2D }): void;
};

type PdfGetDocumentParams = {
  data: Uint8Array;
  useSystemFonts?: boolean;
  isEvalSupported?: boolean;
};

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export interface PDFRenderTask {
    promise: Promise<void>;
  }

  export interface PDFPageProxy {
    getViewport(params: { scale: number }): { width: number; height: number };
    render(params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
      canvasFactory?: PdfCanvasFactory;
    }): PDFRenderTask;
  }

  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }

  export function getDocument(src: PdfGetDocumentParams): PDFDocumentLoadingTask;
}

declare module "pdfjs-dist/build/pdf.mjs" {
  export interface PDFRenderTask {
    promise: Promise<void>;
  }

  export interface PDFPageProxy {
    getViewport(params: { scale: number }): { width: number; height: number };
    render(params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
      canvasFactory?: PdfCanvasFactory;
    }): PDFRenderTask;
  }

  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }

  export function getDocument(src: PdfGetDocumentParams): PDFDocumentLoadingTask;
}
