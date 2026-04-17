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

/** Excel column `width` is in character units; used to approximate wrapped lines. */
const COL_WIDTHS = [36, 36, 68, 68];
const LINE_HEIGHT_PT = 15.5;
const ROW_PADDING_PT = 10;
const MIN_DATA_ROW_PT = 36;
const MAX_ROW_PT = 400;

function estimateLineCount(text: string, columnWidthChars: number): number {
  const width = Math.max(8, columnWidthChars);
  const parts = text.replace(/\r\n/g, "\n").split("\n");
  let lines = 0;
  for (const part of parts) {
    if (part.length === 0) {
      lines += 1;
      continue;
    }
    lines += Math.max(1, Math.ceil(part.length / width));
  }
  return Math.max(1, lines);
}

function estimateRowHeightPt(values: string[]): number {
  let maxLines = 1;
  for (let i = 0; i < values.length; i += 1) {
    const w = COL_WIDTHS[i] ?? 40;
    maxLines = Math.max(maxLines, estimateLineCount(values[i] ?? "", w));
  }
  const height = ROW_PADDING_PT + maxLines * LINE_HEIGHT_PT;
  return Math.min(MAX_ROW_PT, Math.max(MIN_DATA_ROW_PT, height));
}

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
    { key: "c1", width: COL_WIDTHS[0] },
    { key: "c2", width: COL_WIDTHS[1] },
    { key: "c3", width: COL_WIDTHS[2] },
    { key: "c4", width: COL_WIDTHS[3] },
  ];

  const headerRow = ws.addRow(HEADER);
  headerRow.height = Math.min(
    MAX_ROW_PT,
    Math.max(26, estimateRowHeightPt([...HEADER])),
  );
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
    const cells = [
      r.englishTitle,
      r.arabicTitle,
      r.englishDescription,
      r.arabicDescription,
    ];
    const row = ws.addRow(cells);
    row.height = estimateRowHeightPt(cells);
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
