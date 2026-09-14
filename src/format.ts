/**
 * Text for a model to read, not a terminal to pretty-print.
 *
 * Every tool returns text rather than JSON objects, and rows rather than records,
 * because the budget here is tokens. One ride is ~360 samples of ten fields; a JSON
 * object per sample spends roughly three times what a CSV row does on punctuation and
 * repeated key names, and buys nothing a model cannot infer from a header line.
 */

export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return "(no rows)";
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

export function csv(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

/** One decimal is the resolution of every channel here; more is invented precision. */
export const num = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export const km = (meters: number): string => (meters / 1000).toFixed(2);

export const hms = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const day = (date: Date): string => date.toISOString().slice(0, 10);

export const timestamp = (date: Date): string => date.toISOString().slice(0, 16).replace("T", " ");
