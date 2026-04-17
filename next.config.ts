import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "@google-cloud/vision"],
  // pdf.js loads pdf.worker.mjs via dynamic import(); NFT does not always trace it from pdf.mjs.
  outputFileTracingIncludes: {
    "/api/convert": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.sandbox.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.sandbox.min.mjs",
    ],
  },
};

export default nextConfig;
