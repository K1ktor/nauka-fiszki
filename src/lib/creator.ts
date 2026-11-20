import { ParsedCard } from "./csv";

/** Klucz porównania pytań – taki sam jak przy wykrywaniu duplikatów w Store.addCards. */
export function questionKey(q: string): string {
  return q.trim().toLowerCase();
}

/**
 * Fiszki do zapisania z jednego wpisu w kreatorze: sama fiszka,
 * a z opcją „odwrotna” także druga z zamienionymi stronami.
 */
export function cardsFromDraft(question: string, answer: string, tags: string[], reverse: boolean): ParsedCard[] {
  const q = question.trim();
  const a = answer.trim();
  if (!q || !a) return [];
  const out: ParsedCard[] = [{ question: q, answer: a, tags }];
  if (reverse && questionKey(a) !== questionKey(q)) out.push({ question: a, answer: q, tags });
  return out;
}

/** Dodaje lub usuwa tag w polu tekstowym z tagami oddzielonymi przecinkami. */
export function toggleTagText(text: string, tag: string): string {
  const parts = text
    .split(/[|,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const i = parts.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
  if (i >= 0) parts.splice(i, 1);
  else parts.push(tag);
  return parts.join(", ");
}
