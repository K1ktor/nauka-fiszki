import { addDays, DayString } from "./dates";

/**
 * Algorytm powtórek oparty na SM-2 (SuperMemo 2), dostosowany do skali 1-5 gwiazdek.
 *
 *  1★  – w ogóle nie pamiętam        → powtórka jutro, nauka od nowa
 *  2★  – pamiętałem tylko fragment    → powtórka jutro, nauka od nowa
 *  3★  – dobrze, ale z dużym wysiłkiem → zaliczone, odstęp rośnie wolno
 *  4★  – dobrze, po chwili namysłu     → zaliczone
 *  5★  – od razu i bez wahania         → zaliczone, odstęp rośnie najszybciej
 */
export type Stars = 1 | 2 | 3 | 4 | 5;

export interface SchedulingState {
  /** Ile razy z rzędu odpowiedź była zaliczona (≥3★). */
  repetitions: number;
  /** Aktualny odstęp w dniach. */
  interval: number;
  /** Współczynnik łatwości (SM-2 "EF"), min. 1.3. */
  ease: number;
  /** Dzień kolejnego pokazu. */
  dueDate: DayString;
}

export const MIN_EASE = 1.3;
export const DEFAULT_EASE = 2.5;

export function initialState(today: DayString): SchedulingState {
  return { repetitions: 0, interval: 0, ease: DEFAULT_EASE, dueDate: today };
}

export const STAR_LABELS: Record<Stars, string> = {
  1: "Nie pamiętam",
  2: "Ledwo",
  3: "Z trudem",
  4: "Dobrze",
  5: "Perfekcyjnie",
};

export function review(state: SchedulingState, stars: Stars, today: DayString): SchedulingState {
  // SM-2 używa jakości q w skali 0-5; gwiazdki 1-5 traktujemy jako q = gwiazdki.
  const q = stars;
  const ease = Math.max(MIN_EASE, round2(state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))));

  if (q < 3) {
    return { repetitions: 0, interval: 1, ease, dueDate: addDays(today, 1) };
  }

  const repetitions = state.repetitions + 1;
  let interval: number;
  if (repetitions === 1) {
    interval = q === 3 ? 1 : q === 4 ? 2 : 3;
  } else if (repetitions === 2) {
    interval = q === 3 ? 3 : 6;
  } else {
    // Przy 3★ odstęp rośnie wolniej niż wynikałoby z łatwości.
    const factor = q === 3 ? Math.max(1.2, ease * 0.6) : ease;
    interval = Math.max(state.interval + 1, Math.round(state.interval * factor));
  }
  interval = Math.min(interval, 3650);
  return { repetitions, interval, ease, dueDate: addDays(today, interval) };
}

/** Podgląd: za ile dni pojawi się karta dla każdej liczby gwiazdek. */
export function previewIntervals(state: SchedulingState, today: DayString): Record<Stars, number> {
  const out = {} as Record<Stars, number>;
  for (const s of [1, 2, 3, 4, 5] as Stars[]) out[s] = review(state, s, today).interval;
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
