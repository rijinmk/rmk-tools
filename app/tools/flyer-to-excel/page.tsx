import Link from "next/link";
import type { Metadata } from "next";

import { ImagePdfToExcelTool } from "@/components/ImagePdfToExcelTool";
import { ToolPasswordGate } from "@/components/ToolPasswordGate";

export const metadata: Metadata = {
  title: "Flyer → Excel | RMK Tools",
  description:
    "Upload PDFs and images; Vision OCR and Claude build a bilingual Excel workbook.",
};

export default function FlyerToExcelToolPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
      <nav className="mb-8">
        <Link
          href="/"
          className="text-sm font-medium text-[color:var(--muted)] transition hover:text-[color:var(--accent)]"
        >
          ← All tools
        </Link>
      </nav>

      <header className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
          Tool
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Flyers → bilingual Excel
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--muted)] sm:text-base">
          Queue PDFs and/or images. Google Cloud Vision extracts text (PDFs are rendered per
          page); Claude turns OCR text into bilingual rows. On Vercel, large batches upload
          straight to Blob when <code className="text-[color:var(--text)]">BLOB_READ_WRITE_TOKEN</code>{" "}
          is set, avoiding the small serverless request-body cap. You get a summary, optional
          Vision JSON for debugging, and one .xlsx download.
        </p>
      </header>

      <ToolPasswordGate toolTitle="Flyers → bilingual Excel">
        <ImagePdfToExcelTool />
      </ToolPasswordGate>
    </main>
  );
}
