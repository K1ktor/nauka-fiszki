export interface ParsedCard {
  question: string;
  answer: string;
  tags: string[];
}

export interface CsvParseResult {
  cards: ParsedCard[];
  /** Numery wierszy (od 1), które pominięto, z powodem. */
  skipped: { line: number; reason: string }[];
  delimiter: string;
}

const HEADER_WORDS = ["pytanie", "question", "przód", "przod", "front"];

/**
 * Parsuje CSV w formacie: pytanie,odpowiedź[,tagi]
 * - separator wykrywany automatycznie: przecinek, średnik lub tabulator
 * - pola mogą być w cudzysłowach ("a, b" lub "a ""cytat"" b"), także wieloliniowe
 * - opcjonalna trzecia kolumna z tagami rozdzielonymi znakiem | (np. "biologia|komórka")
 * - nagłówek (np. "pytanie,odpowiedź") jest pomijany
 */
export function parseCsv(text: string): CsvParseResult {
  const clean = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(clean);
  const rows = splitRows(clean, delimiter);
  const cards: ParsedCard[] = [];
  const skipped: CsvParseResult["skipped"] = [];

  rows.forEach(({ fields, line }, idx) => {
    if (fields.every((f) => f.trim() === "")) return;
    if (idx === 0 && HEADER_WORDS.includes(fields[0].trim().toLowerCase())) return;
    const question = (fields[0] ?? "").trim();
    const answer = (fields[1] ?? "").trim();
    if (!question || !answer) {
      skipped.push({ line, reason: !question ? "brak pytania" : "brak odpowiedzi" });
      return;
    }
    const tags = parseTags(fields.slice(2).join("|"));
    cards.push({ question, answer, tags });
  });

  return { cards, skipped, delimiter };
}

export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(/[|,;]/)) {
    const name = normalizeTag(t);
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function normalizeTag(t: string): string {
  return t.trim().replace(/^#/, "").replace(/\s+/g, " ").toLowerCase();
}

function detectDelimiter(text: string): string {
  // Liczymy separatory poza cudzysłowami w pierwszej linii.
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  if (counts["\t"] > 0 && counts["\t"] >= counts[","]) return "\t";
  if (counts[";"] > counts[","]) return ";";
  return ",";
}

function splitRows(text: string, delim: string): { fields: string[]; line: number }[] {
  const rows: { fields: string[]; line: number }[] = [];
  let field = "";
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
    } else if (ch === delim) {
      fields.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      fields.push(field);
      rows.push({ fields, line: rowStart });
      fields = [];
      field = "";
      line++;
      rowStart = line;
    } else field += ch;
  }
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    rows.push({ fields, line: rowStart });
  }
  return rows;
}
