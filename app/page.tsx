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
          Queue multiple PDFs and/or images, then generate one workbook. The server extracts
          text from each file with Claude (in order), then asks Claude once to build matching
          bilingual rows (English + Arabic titles and descriptions). You get a Markdown summary
          plus a single .xlsx download.
        </p>
      </header>

      <ImagePdfToExcelTool />
    </main>
  );
}
