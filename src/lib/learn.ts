import { Stars } from "./scheduler";

/**
 * Tryb Nauka: fiszka trafia do Powtórki po LEARN_TARGET ocenach z rzędu ≥ 4★ (kółka w rogu fiszki)
 * albo po kliknięciu „To już umiem”.
 *  - 4–5★ wypełnia jedno kółko,
 *  - 3★ nic nie zmienia (ani nie dolicza, ani nie zeruje),
 *  - 1–2★ zeruje serię (kółka się opróżniają).
 */
export const LEARN_TARGET = 3;
export const DEFAULT_POOL_SIZE = 20;
export const MIN_POOL_SIZE = 5;
export const MAX_POOL_SIZE = 100;
/** Co ile kolejnych nauczonych fiszek (po przekroczeniu limitu) wraca okienko „może pora odpocząć?”. */
export const POPUP_EVERY = 10;
/** Ile nowych fiszek nauczonych w ciągu dnia zalicza dzień do serii (gdy limit jest wyższy). */
export const STREAK_NEW_MAX = 10;

export type Stage = "learn" | "review";

export function learnStep(streak: number, stars: Stars): { streak: number; graduated: boolean } {
  const s = stars >= 4 ? streak + 1 : stars <= 2 ? 0 : streak;
  return s >= LEARN_TARGET ? { streak: LEARN_TARGET, graduated: true } : { streak: s, graduated: false };
}

/** Pierwsza powtórka po wyjściu z Nauki: ostatnia ocena 4★ → jutro, 5★ (lub „To już umiem”) → za 3 dni. */
export function graduationInterval(lastStars: Stars): number {
  return lastStars >= 5 ? 3 : 1;
}

/** Po ilu kolejnych kartach w sesji fiszka wraca: im wyższa ocena, tym później. */
export const RETURN_AFTER: Record<Stars, number> = { 1: 2, 2: 3, 3: 6, 4: 10, 5: 15 };

/** Kolejka sesji Nauki po ocenie pierwszej fiszki: zdejmujemy ją z początku i wstawiamy dalej (albo na koniec). */
export function requeue<T>(queue: T[], stars: Stars): T[] {
  if (queue.length === 0) return queue;
  const [head, ...rest] = queue;
  const at = Math.min(RETURN_AFTER[stars], rest.length);
  return [...rest.slice(0, at), head, ...rest.slice(at)];
}

/** Wstawia element w losowe miejsce (nie na sam początek, jeśli kolejka nie jest pusta). */
export function insertRandom<T>(queue: T[], item: T, rand: () => number = Math.random): T[] {
  const at = queue.length === 0 ? 0 : 1 + Math.floor(rand() * queue.length);
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ile nowych fiszek trzeba dziś nauczyć, żeby dzień liczył się do serii: min(10, dzienny limit). */
export function streakNewTarget(newPerDay: number | null): number {
  return Math.max(1, Math.min(STREAK_NEW_MAX, newPerDay ?? STREAK_NEW_MAX));
}

/**
 * Czy dzień zalicza się do serii: zrobione wszystkie powtórki na dziś (i była co najmniej jedna)
 * ALBO nauczone co najmniej `target` nowych fiszek.
 */
export function dayCompleted(p: { reviewsDone: number; reviewsLeft: number; learned: number; target: number }): boolean {
  return (p.reviewsDone > 0 && p.reviewsLeft === 0) || p.learned >= p.target;
}

/**
 * Okienko „może pora odpocząć?”: pierwszy raz po osiągnięciu dziennego limitu, potem co POPUP_EVERY kolejnych.
 * Zwraca próg (liczbę nauczonych dziś fiszek), przy którym ma się pokazać; null = bez limitu, bez okienka.
 */
export function breakAt(limit: number | null, dismissedAt: number | null = null): number | null {
  if (limit === null) return null;
  return dismissedAt === null ? limit : dismissedAt + POPUP_EVERY;
}

export function clampPoolSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_POOL_SIZE;
  return Math.min(MAX_POOL_SIZE, Math.max(MIN_POOL_SIZE, Math.floor(n)));
}
