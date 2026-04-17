import { ImageData } from "@napi-rs/canvas";

/**
 * pdfjs-dist expects browser globals like ImageData. Node does not define them;
 * @napi-rs/canvas provides a compatible implementation (same as PDF.js NodeCanvasFactory).
 */
if (typeof globalThis.ImageData === "undefined") {
  Object.defineProperty(globalThis, "ImageData", {
    value: ImageData,
    writable: true,
    configurable: true,
  });
}

export {};
