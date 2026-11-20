import { addDays, DayString, parseDay, toDay } from "./dates";
import { DEFAULT_RETENTION, replay, Stars } from "./scheduler";

/** Fiszka „opanowana” = kolejna powtórka za co najmniej tyle dni. */
export const MASTERED_DAYS = 21;

export interface ProgressInfo {
  mastered: number;
  learning: number;
  fresh: number;
  /** Ile fiszek stało się opanowanych w ostatnich 7 dniach (netto, ≥ 0). */
  masteredThisWeek: number;
}

export interface ProgressCard {
  id: number;
  interval: number;
  lastReviewed: DayString | null;
  createdAt: string;
}

export interface ReviewRow {
  cardId: number;
  day: DayString;
  stars: Stars;
}

const isMastered = (interval: number, lastReviewed: DayString | null) =>
  lastReviewed !== null && interval >= MASTERED_DAYS;

/** Podział fiszek na opanowane / w nauce / nowe oraz przyrost opanowanych w ostatnim tygodniu. */
export function computeProgress(
  cards: ProgressCard[],
  reviews: ReviewRow[],
  today: DayString,
  retention = DEFAULT_RETENTION,
): ProgressInfo {
  let mastered = 0;
  let learning = 0;
  let fresh = 0;
  for (const c of cards) {
    if (c.lastReviewed === null) fresh++;
    else if (isMastered(c.interval, c.lastReviewed)) mastered++;
    else learning++;
  }

  // Stan sprzed tygodnia odtwarzamy z historii ocen (bez dzisiejszego dnia i 6 poprzednich).
  const cutoff = addDays(today, -7);
  const byCard = new Map<number, { day: DayString; stars: Stars }[]>();
  for (const r of reviews) {
    if (r.day > cutoff) continue;
    const list = byCard.get(r.cardId) ?? [];
    list.push({ day: r.day, stars: r.stars });
    byCard.set(r.cardId, list);
  }
  const ids = new Set(cards.map((c) => c.id));
  const created = new Map(cards.map((c) => [c.id, c.createdAt]));
  let masteredBefore = 0;
  for (const [id, hist] of byCard) {
    if (!ids.has(id)) continue;
    const st = replay(hist, toDay(new Date(created.get(id)!)), retention);
    if (isMastered(st.interval, st.lastReviewed)) masteredBefore++;
  }
  return { mastered, learning, fresh, masteredThisWeek: Math.max(0, mastered - masteredBefore) };
}

/**
 * Średni czas na jedną fiszkę (sekundy) z odstępów między kolejnymi ocenami w obrębie jednej sesji.
 * Przerwy dłuższe niż 3 minuty traktujemy jako koniec sesji, odstępy krótsze niż 2 s pomijamy. Brak danych → 15 s.
 */
export function secondsPerCard(timestamps: string[]): number {
  const t = timestamps.map((s) => Date.parse(s)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const g = (t[i] - t[i - 1]) / 1000;
    if (g >= 2 && g <= 180) gaps.push(g); // <2 s to nie realna odpowiedź (np. import), >3 min to przerwa
  }
  if (gaps.length < 5) return 15;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** „ok. 6 min” – szacowany czas na `n` fiszek. */
export function formatEta(n: number, perCard: number): string {
  const min = Math.max(1, Math.round((n * perCard) / 60));
  if (min < 60) return `ok. ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `ok. ${h} h ${m} min` : `ok. ${h} h`;
}

/** Dni ostatnich `weeks` tygodni (od poniedziałku), ostatni tydzień zawiera dzisiejszy dzień. */
export function lastWeeks(today: DayString, weeks: number): DayString[][] {
  const dow = (parseDay(today).getDay() + 6) % 7;
  const start = addDays(today, -dow - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}
