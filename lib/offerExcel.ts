import ExcelJS from "exceljs";

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

export async function buildOffersWorkbookBuffer(
  rows: OfferRow[],
  sheetName = "Offers",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName(sheetName), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { key: "c1", width: 36 },
    { key: "c2", width: 36 },
    { key: "c3", width: 68 },
    { key: "c4", width: 68 },
  ];

  const headerRow = ws.addRow(HEADER);
  headerRow.height = 26;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4F46E5" },
  };
  headerRow.alignment = { wrapText: true, vertical: "middle" };
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FF312E81" } },
      bottom: { style: "thin", color: { argb: "FF312E81" } },
      left: { style: "thin", color: { argb: "FF312E81" } },
      right: { style: "thin", color: { argb: "FF312E81" } },
    };
  });

  rows.forEach((r, idx) => {
    const row = ws.addRow([
      r.englishTitle,
      r.arabicTitle,
      r.englishDescription,
      r.arabicDescription,
    ]);
    const zebra = idx % 2 === 0 ? "FFF4F4F5" : "FFFFFFFF";
    row.alignment = { wrapText: true, vertical: "top" };
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: zebra },
      };
      cell.border = {
        top: { style: "hair", color: { argb: "FFE4E4E7" } },
        bottom: { style: "hair", color: { argb: "FFE4E4E7" } },
        left: { style: "hair", color: { argb: "FFE4E4E7" } },
        right: { style: "hair", color: { argb: "FFE4E4E7" } },
      };
    });
  });

  const lastRow = 1 + rows.length;
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: lastRow, column: 4 },
  };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
