import * as XLSX from "xlsx";

export type OfferRow = {
  englishTitle: string;
  arabicTitle: string;
  englishDescription: string;
  arabicDescription: string;
};

const HEADER = [
  "English Title",
  "Arabic Title",
  "English Description & Terms",
  "Arabic Description & Terms",
];

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "_").trim() || "Offers";
  return cleaned.slice(0, 31);
}

export function buildOffersWorkbookBuffer(
  rows: OfferRow[],
  sheetName = "Offers",
): Buffer {
  const body: (string | number | boolean | null)[][] = rows.map((r) => [
    r.englishTitle,
    r.arabicTitle,
    r.englishDescription,
    r.arabicDescription,
  ]);
  const aoa: (string | number | boolean | null)[][] = [HEADER, ...body];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 34 },
    { wch: 34 },
    { wch: 72 },
    { wch: 72 },
  ];

  const lastRow = aoa.length;
  if (lastRow >= 1) {
    ws["!autofilter"] = { ref: `A1:D${lastRow}` };
  }

  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
