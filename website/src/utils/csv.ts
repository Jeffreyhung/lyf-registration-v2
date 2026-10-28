// Minimal CSV writer for the admin dashboard's one-click exports. The grid's
// own export covers the generic "what I see" case; this covers fixed tables
// built from the loaded registrations.

// Cells starting with these would be evaluated by spreadsheet apps. Same list
// the data grid uses for its escapeFormulas option.
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"]

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value)
  if (text.length > 0 && FORMULA_PREFIXES.includes(text[0])) {
    text = `'${text}`
  }
  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export type CsvTable = { headers: string[]; rows: unknown[][] }

export function toCsv({ headers, rows }: CsvTable): string {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
}

// Same download mechanism as the data grid: an object URL on a throwaway
// anchor. The BOM makes Excel open UTF-8 (accented names) correctly.
export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url))
}
