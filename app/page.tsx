import Link from "next/link";

const tools = [
  {
    href: "/tools/flyer-to-excel",
    title: "Flyers → bilingual Excel",
    description:
      "Upload PDFs and images, run Vision OCR, then generate one styled Excel workbook with English and Arabic columns.",
    badge: "Vision + Claude",
  },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-16">
      <header className="mb-14 text-center sm:text-left">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--muted)]">
          RMK Tools
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-[color:var(--text)] sm:text-5xl">
          Tools
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[color:var(--muted)] sm:mx-0">
          Small utilities for everyday work. Pick a tool below — you may be asked for an access
          password before it opens.
        </p>
      </header>

      <section aria-labelledby="tools-heading">
        <h2 id="tools-heading" className="sr-only">
          Available tools
        </h2>
        <ul className="grid gap-5 sm:grid-cols-1">
          {tools.map((tool) => (
            <li key={tool.href}>
              <Link
                href={tool.href}
                className="group flex flex-col rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 transition hover:border-[color:var(--accent)] hover:shadow-lg hover:shadow-[color:var(--accent)]/10 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="min-w-0 flex-1">
                  <span className="inline-block rounded-full border border-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-0.5 text-xs font-medium text-[color:var(--muted)]">
                    {tool.badge}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold tracking-tight text-[color:var(--text)] group-hover:text-[color:var(--accent-hover)]">
                    {tool.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{tool.description}</p>
                </div>
                <span className="mt-4 shrink-0 text-sm font-semibold text-[color:var(--accent)] sm:mt-8">
                  Open
                  <span aria-hidden className="ml-1 transition group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-20 border-t border-[color:var(--border)] pt-8 text-center text-xs text-[color:var(--muted)]">
        RMK Tools — internal utilities
      </footer>
    </main>
  );
}
