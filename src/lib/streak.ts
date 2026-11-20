import { addDays, DayString } from "./dates";

export interface StreakInfo {
  /** Bieżąca seria dni z rzędu (dziś lub wczoraj musi być dniem nauki). */
  current: number;
  /** Najdłuższa seria w historii. */
  best: number;
  /** Czy dziś już była nauka. */
  studiedToday: boolean;
}

/** Oblicza serię na podstawie listy dni, w których była co najmniej jedna powtórka. */
export function computeStreak(studyDays: DayString[], today: DayString): StreakInfo {
  const days = new Set(studyDays);
  const studiedToday = days.has(today);

  let current = 0;
  let cursor = studiedToday ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  let best = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue; // nie jest początkiem serii
    let len = 0;
    let c = d;
    while (days.has(c)) {
      len++;
      c = addDays(c, 1);
    }
    best = Math.max(best, len);
  }
  return { current, best, studiedToday };
}
