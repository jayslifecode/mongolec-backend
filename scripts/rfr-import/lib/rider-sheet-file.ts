/**
 * Rally for Rangers — RFR_Riders_Master.xlsx read/write (exceljs wrapper around rider-sheet.ts).
 *
 * Workbook layout:
 *  - "Riders": header row + one row per rider (see rider-sheet.ts). "Rallies (count)" is a
 *    COUNTIF formula so it stays right while the client edits.
 *  - "Rally key": Title | Slug | Start date — maps each rally column title to its slug.
 */
import ExcelJS from 'exceljs';
import { SHEET_FIXED_HEADERS, type SheetRally } from './rider-sheet';

export const RIDERS_SHEET = 'Riders';
export const RALLY_KEY_SHEET = 'Rally key';
const COUNT_COLUMN = SHEET_FIXED_HEADERS.indexOf('Rallies (count)') + 1;
const FIRST_RALLY_COLUMN = SHEET_FIXED_HEADERS.length + 1;

export interface KeyedRally extends SheetRally {
  startDate: Date;
}

function sheetRowsOf(ws: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).text ?? '');
    rows.push(cells);
  }
  return rows;
}

export async function writeRiderSheet(
  outPath: string,
  rows: string[][],
  rallies: KeyedRally[]
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(RIDERS_SHEET, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col, i) => {
    col.width = i < SHEET_FIXED_HEADERS.length ? 18 : 14;
  });

  const lastRallyColumn = ws.getColumn(FIRST_RALLY_COLUMN + rallies.length - 1).letter;
  const firstRallyColumn = ws.getColumn(FIRST_RALLY_COLUMN).letter;
  for (let r = 2; r <= rows.length; r++) {
    const range = `${firstRallyColumn}${r}:${lastRallyColumn}${r}`;
    ws.getRow(r).getCell(COUNT_COLUMN).value = {
      formula: `COUNTIF(${range},"x")`,
      result: Number(rows[r - 1][COUNT_COLUMN - 1]) || 0,
    };
  }

  const key = wb.addWorksheet(RALLY_KEY_SHEET);
  key.addRow(['Title', 'Slug', 'Start date']);
  key.getRow(1).font = { bold: true };
  rallies.forEach(r => key.addRow([r.title, r.slug, r.startDate.toISOString().slice(0, 10)]));
  key.columns.forEach(col => {
    col.width = 22;
  });

  await wb.xlsx.writeFile(outPath);
}

export async function readRiderSheet(
  inPath: string
): Promise<{ rows: string[][]; rallyKey: Map<string, string> }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inPath);
  const riders = wb.getWorksheet(RIDERS_SHEET);
  const key = wb.getWorksheet(RALLY_KEY_SHEET);
  if (!riders || !key) {
    throw new Error(`${inPath}: expected worksheets "${RIDERS_SHEET}" and "${RALLY_KEY_SHEET}"`);
  }
  const rallyKey = new Map(
    sheetRowsOf(key)
      .slice(1)
      .filter(([title, slug]) => title?.trim() && slug?.trim())
      .map(([title, slug]) => [title.trim(), slug.trim()] as [string, string])
  );
  return { rows: sheetRowsOf(riders), rallyKey };
}
