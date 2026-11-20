import { addDays, DayString, diffDays } from "./dates";

/**
 * Algorytm powtórek FSRS (Free Spaced Repetition Scheduler, wersja 5) z domyślnymi parametrami.
 *
 * Dla każdej fiszki pamiętamy:
 *  - stabilność S – po ilu dniach szansa przypomnienia spada do 90%,
 *  - trudność D (1–10).
 * Następną powtórkę planujemy na dzień, w którym przewidywana szansa przypomnienia spadnie
 * do docelowej skuteczności (domyślnie 90%).
 *
 * Gwiazdki → oceny FSRS:
 *  1★ Nie pamiętam  → Again (1)  – zapomniane, powrót jutro
 *  2★ Ledwo         → Again (1)  – tylko fragment = nie zaliczone, powrót jutro
 *  3★ Z trudem      → Hard  (2)  – zaliczone z dużym wysiłkiem, odstęp rośnie wolno
 *  4★ Dobrze        → Good  (3)
 *  5★ Perfekcyjnie  → Easy  (4)  – odstęp rośnie najszybciej
 */
export type Stars = 1 | 2 | 3 | 4 | 5;
export type Grade = 1 | 2 | 3 | 4;

export interface SchedulingState {
  /** Stabilność w dniach (null = fiszka jeszcze nie oceniana). */
  stability: number | null;
  /** Trudność 1–10 (null = fiszka jeszcze nie oceniana). */
  difficulty: number | null;
  /** Ile razy z rzędu odpowiedź była zaliczona (≥3★). */
  repetitions: number;
  /** Ile razy fiszka została zapomniana (1–2★) po wcześniejszym zaliczeniu. */
  lapses: number;
  /** Aktualny odstęp w dniach. */
  interval: number;
  /** Dzień kolejnego pokazu. */
  dueDate: DayString;
  /** Dzień ostatniej oceny. */
  lastReviewed: DayString | null;
}

export const STAR_LABELS: Record<Stars, string> = {
  1: "Nie pamiętam",
  2: "Ledwo",
  3: "Z trudem",
  4: "Dobrze",
  5: "Perfekcyjnie",
};

export const STAR_TO_GRADE: Record<Stars, Grade> = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 };

export const DEFAULT_RETENTION = 0.9;
export const MIN_RETENTION = 0.7;
export const MAX_RETENTION = 0.99;
export const MAX_INTERVAL = 3650;

/** Domyślne parametry FSRS-5. */
export const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605,
  2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY = -0.5;
const FACTOR = 19 / 81; // tak, by R(S, S) = 0.9

export function initialState(today: DayString): SchedulingState {
  return { stability: null, difficulty: null, repetitions: 0, lapses: 0, interval: 0, dueDate: today, lastReviewed: null };
}

export function clampRetention(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_RETENTION;
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, r));
}

/** Prawdopodobieństwo przypomnienia po `days` dniach przy stabilności `s`. */
export function retrievability(days: number, s: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, days)) / s, DECAY);
}

/** Odstęp (dni), po którym szansa przypomnienia spadnie do `retention`. */
export function nextInterval(s: number, retention = DEFAULT_RETENTION): number {
  const r = clampRetention(retention);
  const iv = (s / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
  return Math.min(MAX_INTERVAL, Math.max(1, Math.round(iv)));
}

const clampD = (d: number) => Math.min(10, Math.max(1, d));
const initStability = (g: Grade) => Math.max(0.1, W[g - 1]);
const initDifficulty = (g: Grade) => W[4] - Math.exp(W[5] * (g - 1)) + 1;

function nextDifficulty(d: number, g: Grade): number {
  const delta = -W[6] * (g - 3);
  const dp = d + (delta * (10 - d)) / 9; // tłumienie liniowe
  return clampD(W[7] * initDifficulty(4) + (1 - W[7]) * dp); // powrót do średniej
}

function recallStability(d: number, s: number, r: number, g: Grade): number {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
}

function forgetStability(d: number, s: number, r: number): number {
  const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  return Math.min(sf, s);
}

function sameDayStability(s: number, g: Grade): number {
  return s * Math.exp(W[17] * (g - 3 + W[18]));
}

/** Nowy stan fiszki po ocenie `stars` w dniu `today`. */
export function review(
  state: SchedulingState,
  stars: Stars,
  today: DayString,
  retention = DEFAULT_RETENTION,
): SchedulingState {
  const g = STAR_TO_GRADE[stars];
  let s: number;
  let d: number;
  if (state.stability === null || state.difficulty === null || state.lastReviewed === null) {
    s = initStability(g);
    d = clampD(initDifficulty(g));
  } else {
    const elapsed = Math.max(0, diffDays(state.lastReviewed, today));
    d = nextDifficulty(state.difficulty, g);
    if (elapsed === 0) {
      s = sameDayStability(state.stability, g);
    } else {
      const r = retrievability(elapsed, state.stability);
      s = g === 1 ? forgetStability(state.difficulty, state.stability, r) : recallStability(state.difficulty, state.stability, r, g);
    }
  }
  s = Math.max(0.1, s);
  const passed = g > 1;
  // Zapomniana fiszka wraca jutro, niezależnie od stabilności.
  const interval = passed ? nextInterval(s, retention) : 1;
  return {
    stability: round4(s),
    difficulty: round4(d),
    repetitions: passed ? state.repetitions + 1 : 0,
    lapses: !passed && state.repetitions > 0 ? state.lapses + 1 : state.lapses,
    interval,
    dueDate: addDays(today, interval),
    lastReviewed: today,
  };
}

/** Odtwarza stan fiszki z historii ocen (kolejne dni i gwiazdki, od najstarszej). */
export function replay(
  history: { day: DayString; stars: Stars }[],
  createdDay: DayString,
  retention = DEFAULT_RETENTION,
): SchedulingState {
  let s = initialState(createdDay);
  for (const h of history) s = review(s, h.stars, h.day, retention);
  return s;
}

/** Podgląd: za ile dni pojawi się karta dla każdej liczby gwiazdek. */
export function previewIntervals(state: SchedulingState, today: DayString, retention = DEFAULT_RETENTION): Record<Stars, number> {
  const out = {} as Record<Stars, number>;
  for (const s of [1, 2, 3, 4, 5] as Stars[]) out[s] = review(state, s, today, retention).interval;
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
