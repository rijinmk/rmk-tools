import { ImagePdfToExcelTool } from "@/components/ImagePdfToExcelTool";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-14">
      <header className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
          RMK Tools
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Flyers → bilingual Excel
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--muted)] sm:text-base">
          Queue multiple PDFs and/or images, then generate one workbook. Text is extracted with
          Google Cloud Vision (PDFs are rendered to images per page), then Claude turns that OCR
          text into bilingual rows. You get a Markdown summary, a Vision JSON block for
          verification, and one .xlsx download.
        </p>
      </header>

      <ImagePdfToExcelTool />
    </main>
  );
}
