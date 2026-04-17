import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "@google-cloud/vision"],
};

export default nextConfig;
