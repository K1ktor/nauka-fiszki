import { addDays, DayString, diffDays, toDay } from "./dates";
import { ParsedCard, normalizeTag } from "./csv";
import type { ReviewRow } from "./progress";
import { clampRetention, DEFAULT_RETENTION, replay, SchedulingState, Stars, initialState, review } from "./scheduler";
import { clampPoolSize, DEFAULT_POOL_SIZE, backToLearn as sendsBackToLearn, dayCompleted, GRADUATION_INTERVAL, learnStep, shuffle, Stage, streakNewTarget } from "./learn";

/** Minimalny interfejs bazy SQL – realizowany przez Tauri (SQLite na dysku) lub sql.js (przeglądarka/testy). */
export interface SqlDriver {
  execute(sql: string, params?: unknown[]): Promise<{ lastInsertId?: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Card extends SchedulingState {
  id: number;
  question: string;
  answer: string;
  tags: string[];
  createdAt: string;
  /** Uśpiona fiszka nie pojawia się w sesjach nauki. */
  suspended: boolean;
  /** Średnia gwiazdek ze wszystkich ocen tej fiszki (null = jeszcze nieoceniona). */
  avgStars: number | null;
  /** Ile razy fiszka została oceniona. */
  ratings: number;
  /** „learn” = tryb Nauka, „review” = tryb Powtórka (terminy wg FSRS). */
  stage: Stage;
  /** Seria ocen ≥4★ z rzędu w Nauce (wypełnione kółka, 0–3). */
  learnStreak: number;
  /** Czy fiszka jest w aktywnej puli Nauki. */
  inPool: boolean;
}

/** Filtr nauki bez oceny: tylko fiszki ze średnią gwiazdek poniżej progu. */
export interface StarFilter {
  /** Próg (ściśle mniej niż); null = bez filtra. */
  below: number | null;
  /** Czy brać też fiszki, które nie mają jeszcze żadnej oceny. */
  includeUnrated: boolean;
}

export const NO_STAR_FILTER: StarFilter = { below: null, includeUnrated: true };

export function matchesStarFilter(card: Card, f: StarFilter): boolean {
  if (f.below === null) return true;
  if (card.avgStars === null) return f.includeUnrated;
  return card.avgStars < f.below;
}

/** Ustawienia nauki zapisywane w bazie. */
export interface Settings {
  /** Docelowa skuteczność FSRS (0.7–0.99). */
  retention: number;
  /** Dzienny limit nowych fiszek w Nauce – po nim okienko „może pora odpocząć?” (null = bez limitu). */
  newPerDay: number | null;
  /** Czy wpisywać odpowiedź przed odsłonięciem. */
  typeAnswer: boolean;
  /** Ile fiszek naraz jest w aktywnej puli Nauki. */
  poolSize: number;
}

export const DEFAULT_SETTINGS: Settings = { retention: DEFAULT_RETENTION, newPerDay: null, typeAnswer: false, poolSize: DEFAULT_POOL_SIZE };

export function isNew(card: Card): boolean {
  return card.lastReviewed === null;
}

const inTags = (c: Card, tags: string[]) => tags.length === 0 || c.tags.some((t) => tags.includes(t));

/** Kolejka Powtórki: fiszki z etapu „review” z terminem na dziś lub zaległe, najstarsze terminy najpierw. */
export function reviewQueue(cards: Card[], today: DayString, tags: string[] = []): Card[] {
  return cards
    .filter((c) => !c.suspended && c.stage === "review" && c.dueDate <= today && inTags(c, tags))
    .sort((a, b) => (a.dueDate === b.dueDate ? a.id - b.id : a.dueDate < b.dueDate ? -1 : 1));
}

/** Aktywne fiszki w trybie Nauka (z wybranych tagów). */
export function learnCards(cards: Card[], tags: string[] = []): Card[] {
  return cards.filter((c) => !c.suspended && c.stage === "learn" && inTags(c, tags));
}

/**
 * Przesuwane okno puli: fiszki już w puli (z wybranych tagów) + losowe kolejne fiszki z Nauki,
 * aż pula osiągnie `size`. Zwraca identyfikatory fiszek do dopisania do puli.
 */
export function poolAdditions(cards: Card[], tags: string[], size: number, rand: () => number = Math.random): number[] {
  const learn = learnCards(cards, tags);
  const have = learn.filter((c) => c.inPool).length;
  if (have >= size) return [];
  return shuffle(learn.filter((c) => !c.inPool), rand).slice(0, size - have).map((c) => c.id);
}

export interface TagInfo {
  name: string;
  count: number;
  due: number;
}

export interface ImportResult {
  added: number;
  duplicates: number;
  /** Identyfikatory dodanych fiszek, w kolejności wejścia. */
  ids: number[];
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    repetitions INTEGER NOT NULL DEFAULT 0,
    interval INTEGER NOT NULL DEFAULT 0,
    ease REAL NOT NULL DEFAULT 2.5,
    due_date TEXT NOT NULL,
    last_reviewed TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due_date)`,
  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS card_tags (
    card_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (card_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    review_day TEXT NOT NULL,
    reviewed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_day ON reviews(review_day)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(card_id)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS streak_days (
    day TEXT PRIMARY KEY
  )`,
];

interface CardRow {
  id: number;
  question: string;
  answer: string;
  repetitions: number;
  interval: number;
  stability: number | null;
  difficulty: number | null;
  lapses: number | null;
  due_date: string;
  last_reviewed: string | null;
  created_at: string;
  suspended: number;
  tags: string | null;
  avg_stars: number | null;
  ratings: number;
  stage: string | null;
  learn_streak: number | null;
  in_pool: number | null;
}

export class Store {
  constructor(private db: SqlDriver) {}

  async init(): Promise<void> {
    for (const stmt of SCHEMA) await this.db.execute(stmt);
    // Migracje dla baz utworzonych przez starsze wersje.
    const cols = await this.db.select<{ name: string }>(`PRAGMA table_info(cards)`);
    if (!cols.some((c) => c.name === "suspended")) {
      await this.db.execute(`ALTER TABLE cards ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0`);
    }
    // 0.5.0: FSRS – stabilność, trudność i liczba zapomnień.
    if (!cols.some((c) => c.name === "stability")) {
      await this.db.execute(`ALTER TABLE cards ADD COLUMN stability REAL`);
      await this.db.execute(`ALTER TABLE cards ADD COLUMN difficulty REAL`);
      await this.db.execute(`ALTER TABLE cards ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0`);
    }
    await this.migrateToFsrs();
    // 0.9.0: tryby Nauka / Powtórka.
    if (!cols.some((c) => c.name === "stage")) await this.migrateToStages();
  }

  /**
   * Podział na Naukę i Powtórkę: fiszki, których ostatnia ocena to ≥4★, idą do Powtórki (z dotychczasowym
   * terminem FSRS), reszta do Nauki. Dotychczasowe dni nauki zostają w serii.
   */
  private async migrateToStages(): Promise<void> {
    await this.db.execute(`ALTER TABLE cards ADD COLUMN stage TEXT NOT NULL DEFAULT 'learn'`);
    await this.db.execute(`ALTER TABLE cards ADD COLUMN learn_streak INTEGER NOT NULL DEFAULT 0`);
    await this.db.execute(`ALTER TABLE cards ADD COLUMN in_pool INTEGER NOT NULL DEFAULT 0`);
    await this.db.execute(`ALTER TABLE cards ADD COLUMN learned_day TEXT`);
    const rcols = await this.db.select<{ name: string }>(`PRAGMA table_info(reviews)`);
    if (!rcols.some((c) => c.name === "mode")) await this.db.execute(`ALTER TABLE reviews ADD COLUMN mode TEXT`);
    await this.db.execute(
      `UPDATE cards SET stage = 'review' WHERE (SELECT r.stars FROM reviews r WHERE r.card_id = cards.id
         ORDER BY r.reviewed_at DESC, r.id DESC LIMIT 1) >= 4`,
    );
    await this.db.execute(`INSERT OR IGNORE INTO streak_days (day) SELECT DISTINCT review_day FROM reviews`);
  }

  /**
   * Fiszki ocenione jeszcze przez SM-2 (mają historię ocen, ale brak stabilności): odtwarzamy ich stan FSRS
   * z całej historii ocen. Termin powtórki nigdy nie jest przyspieszany – bierzemy późniejszy z obecnego
   * i wyliczonego przez FSRS. Idempotentne: dotyczy tylko fiszek bez stabilności.
   */
  private async migrateToFsrs(): Promise<void> {
    const pending = await this.db.select<{ id: number; due_date: string; created_at: string }>(
      `SELECT id, due_date, created_at FROM cards
       WHERE stability IS NULL AND EXISTS (SELECT 1 FROM reviews r WHERE r.card_id = cards.id)`,
    );
    if (pending.length === 0) return;
    const { retention } = await this.getSettings();
    for (const c of pending) {
      const hist = await this.db.select<{ stars: number; review_day: string }>(
        `SELECT stars, review_day FROM reviews WHERE card_id = $1 ORDER BY reviewed_at, id`,
        [c.id],
      );
      const st = replay(
        hist.map((h) => ({ day: h.review_day, stars: Number(h.stars) as Stars })),
        toDay(new Date(c.created_at)),
        retention,
      );
      const due = st.dueDate > c.due_date ? st.dueDate : c.due_date;
      const last = st.lastReviewed!;
      await this.db.execute(
        `UPDATE cards SET stability = $1, difficulty = $2, repetitions = $3, lapses = $4, interval = $5,
                          due_date = $6, last_reviewed = $7 WHERE id = $8`,
        [st.stability, st.difficulty, st.repetitions, st.lapses, Math.max(1, diffDays(last, due)), due, last, c.id],
      );
    }
  }

  async getSettings(): Promise<Settings> {
    const rows = await this.db.select<{ key: string; value: string }>(`SELECT key, value FROM settings`);
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const n = m.newPerDay === undefined || m.newPerDay === "all" ? null : Number(m.newPerDay);
    return {
      retention: m.retention === undefined ? DEFAULT_SETTINGS.retention : clampRetention(Number(m.retention)),
      newPerDay: n === null || !Number.isFinite(n) ? null : Math.max(0, Math.floor(n)),
      typeAnswer: m.typeAnswer === "1",
      poolSize: m.poolSize === undefined ? DEFAULT_POOL_SIZE : clampPoolSize(Number(m.poolSize)),
    };
  }

  async saveSettings(patch: Partial<Settings>): Promise<void> {
    const put = (k: string, v: string) =>
      this.db.execute(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]);
    if (patch.retention !== undefined) await put("retention", String(clampRetention(patch.retention)));
    if (patch.newPerDay !== undefined) await put("newPerDay", patch.newPerDay === null ? "all" : String(Math.max(0, Math.floor(patch.newPerDay))));
    if (patch.typeAnswer !== undefined) await put("typeAnswer", patch.typeAnswer ? "1" : "0");
    if (patch.poolSize !== undefined) await put("poolSize", String(clampPoolSize(patch.poolSize)));
  }

  /** Czy pokazać ekran powitalny: tylko przy pierwszym uruchomieniu na pustej bazie. */
  async needsOnboarding(): Promise<boolean> {
    const done = await this.db.select<{ value: string }>(`SELECT value FROM settings WHERE key = 'onboarded'`);
    if (done.length > 0) return false;
    const n = await this.db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM cards`);
    if (Number(n[0]?.n ?? 0) > 0) {
      // Dotychczasowy użytkownik z fiszkami – nie pokazujemy mu powitania.
      await this.finishOnboarding("local");
      return false;
    }
    return true;
  }

  /** Rodzaj konta: „google” po zalogowaniu (jeszcze niedostępne), inaczej „local”. */
  async getAccount(): Promise<"local" | "google"> {
    const r = await this.db.select<{ value: string }>(`SELECT value FROM settings WHERE key = 'account'`);
    return r[0]?.value === "google" ? "google" : "local";
  }

  async finishOnboarding(account: "local" | "google"): Promise<void> {
    for (const [k, v] of [["onboarded", "1"], ["account", account]]) {
      await this.db.execute(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]);
    }
  }

  /** Ile fiszek przeszło dziś z Nauki do Powtórki („nauczone dziś”). */
  async learnedToday(today: DayString): Promise<number> {
    const [r] = await this.db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM cards WHERE learned_day = $1`, [today]);
    return Number(r?.n ?? 0);
  }

  /** Ile nowych fiszek zostało do dziennego limitu (null = bez limitu). */
  async remainingNew(today: DayString): Promise<number | null> {
    const { newPerDay } = await this.getSettings();
    if (newPerDay === null) return null;
    return Math.max(0, newPerDay - (await this.learnedToday(today)));
  }

  /** Ile ocen wystawiono dziś w Powtórce. */
  async reviewsDoneToday(today: DayString): Promise<number> {
    const [r] = await this.db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM reviews WHERE review_day = $1 AND mode = 'review'`,
      [today],
    );
    return Number(r?.n ?? 0);
  }

  /**
   * Zapisuje dzisiejszy dzień w serii, jeśli spełniony warunek: wszystkie powtórki na dziś zrobione
   * albo nauczone min(10, limit) nowych fiszek. Zaliczonego dnia nie cofamy. Zwraca, czy dzień jest zaliczony.
   */
  async markStreakDay(today: DayString): Promise<boolean> {
    const done = await this.db.select<{ day: string }>(`SELECT day FROM streak_days WHERE day = $1`, [today]);
    if (done.length > 0) return true;
    const [{ newPerDay }, reviewsDone, learned, [left]] = await Promise.all([
      this.getSettings(),
      this.reviewsDoneToday(today),
      this.learnedToday(today),
      this.db.select<{ n: number }>(
        `SELECT COUNT(*) AS n FROM cards WHERE stage = 'review' AND suspended = 0 AND due_date <= $1`,
        [today],
      ),
    ]);
    const ok = dayCompleted({ reviewsDone, reviewsLeft: Number(left?.n ?? 0), learned, target: streakNewTarget(newPerDay) });
    if (ok) await this.db.execute(`INSERT OR IGNORE INTO streak_days (day) VALUES ($1)`, [today]);
    return ok;
  }

  async listCards(): Promise<Card[]> {
    const rows = await this.db.select<CardRow>(
      `SELECT c.*, (SELECT group_concat(t.name, '|') FROM card_tags ct JOIN tags t ON t.id = ct.tag_id
                    WHERE ct.card_id = c.id) AS tags,
              r.avg_stars AS avg_stars, COALESCE(r.n, 0) AS ratings
       FROM cards c
       LEFT JOIN (SELECT card_id, AVG(stars) AS avg_stars, COUNT(*) AS n FROM reviews GROUP BY card_id) r
         ON r.card_id = c.id
       ORDER BY c.id DESC`,
    );
    return rows.map(rowToCard);
  }

  /** Fiszki do Powtórki na dziś (opcjonalnie tylko z wybranych tagów). */
  async dueReviews(today: DayString, tags: string[] = []): Promise<Card[]> {
    return reviewQueue(await this.listCards(), today, tags);
  }

  /**
   * Aktywna pula Nauki dla wybranych tagów: dopełnia ją losowymi fiszkami z Nauki do rozmiaru z ustawień
   * (pula zapisuje się w bazie między sesjami) i zwraca fiszki z puli.
   */
  async learnPool(tags: string[] = [], rand: () => number = Math.random): Promise<Card[]> {
    const { poolSize } = await this.getSettings();
    let all = await this.listCards();
    const add = poolAdditions(all, tags, poolSize, rand);
    if (add.length > 0) {
      for (const id of add) await this.db.execute(`UPDATE cards SET in_pool = 1 WHERE id = $1`, [id]);
      all = await this.listCards();
    }
    return learnCards(all, tags).filter((c) => c.inPool);
  }

  async addCards(cards: ParsedCard[], extraTags: string[] = [], today = toDay()): Promise<ImportResult> {
    const existing = new Set(
      (await this.db.select<{ question: string }>(`SELECT question FROM cards`)).map((r) => r.question.toLowerCase()),
    );
    let added = 0;
    let duplicates = 0;
    const ids: number[] = [];
    const init = initialState(today);
    const ease = 2.5; // kolumna po SM-2, nieużywana
    for (const c of cards) {
      const key = c.question.trim().toLowerCase();
      if (existing.has(key)) {
        duplicates++;
        continue;
      }
      existing.add(key);
      const res = await this.db.execute(
        `INSERT INTO cards (question, answer, repetitions, interval, ease, due_date, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [c.question.trim(), c.answer.trim(), init.repetitions, init.interval, ease, init.dueDate, new Date().toISOString()],
      );
      const id = res.lastInsertId ?? (await this.lastId());
      await this.setTags(id, [...c.tags, ...extraTags]);
      ids.push(id);
      added++;
    }
    return { added, duplicates, ids };
  }

  /** Aktywne (nieuśpione) fiszki z wybranych tagów – do nauki bez oceny, opcjonalnie tylko te ze słabą średnią. */
  async practiceCards(tags: string[] = [], stars: StarFilter = NO_STAR_FILTER): Promise<Card[]> {
    const all = await this.listCards();
    return all.filter(
      (c) => !c.suspended && (tags.length === 0 || c.tags.some((t) => tags.includes(t))) && matchesStarFilter(c, stars),
    );
  }

  async setSuspended(ids: number[], suspended: boolean): Promise<void> {
    for (const id of ids) {
      await this.db.execute(`UPDATE cards SET suspended = $1 WHERE id = $2`, [suspended ? 1 : 0, id]);
    }
  }

  async deleteCards(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.db.execute(`DELETE FROM card_tags WHERE card_id = $1`, [id]);
      await this.db.execute(`DELETE FROM reviews WHERE card_id = $1`, [id]);
      await this.db.execute(`DELETE FROM cards WHERE id = $1`, [id]);
    }
    await this.pruneTags();
  }

  /** Średnia ocen (gwiazdek) w przedziale dni [from, to] włącznie. */
  async averageStars(from: DayString, to: DayString): Promise<{ avg: number | null; count: number }> {
    const [r] = await this.db.select<{ avg: number | null; n: number }>(
      `SELECT AVG(stars) AS avg, COUNT(*) AS n FROM reviews WHERE review_day >= $1 AND review_day <= $2`,
      [from, to],
    );
    return { avg: r?.avg == null ? null : Number(r.avg), count: Number(r?.n ?? 0) };
  }

  async updateCard(id: number, question: string, answer: string, tags: string[]): Promise<void> {
    await this.db.execute(`UPDATE cards SET question = $1, answer = $2 WHERE id = $3`, [question.trim(), answer.trim(), id]);
    await this.setTags(id, tags);
  }

  async deleteCard(id: number): Promise<void> {
    await this.deleteCards([id]);
  }

  private async saveRating(card: Card, stars: Stars, today: DayString, mode: Stage): Promise<void> {
    await this.db.execute(
      `INSERT INTO reviews (card_id, stars, review_day, reviewed_at, mode) VALUES ($1, $2, $3, $4, $5)`,
      [card.id, stars, today, new Date().toISOString(), mode],
    );
  }

  /**
   * Ocena w Powtórce: FSRS wyznacza kolejny dzień (2★ = jutro, 3★ = krótszy odstęp). Przy 1★ fiszka wraca do Nauki
   * z wyzerowaną serią (od razu do aktywnej puli).
   */
  async rateReview(card: Card, stars: Stars, today = toDay()): Promise<SchedulingState & { backToLearn: boolean }> {
    const { retention } = await this.getSettings();
    const next = review(card, stars, today, retention);
    const backToLearn = sendsBackToLearn(stars);
    await this.db.execute(
      `UPDATE cards SET repetitions = $1, interval = $2, stability = $3, difficulty = $4, lapses = $5,
                        due_date = $6, last_reviewed = $7, stage = $8, learn_streak = 0, in_pool = $9 WHERE id = $10`,
      [next.repetitions, backToLearn ? 0 : next.interval, next.stability, next.difficulty, next.lapses,
        backToLearn ? today : next.dueDate, today, backToLearn ? "learn" : "review", backToLearn ? 1 : 0, card.id],
    );
    await this.saveRating(card, stars, today, "review");
    return { ...next, backToLearn };
  }

  /**
   * Ocena w Nauce: aktualizuje serię kółek i stan FSRS. Po 3 ocenach ≥4★ z rzędu (albo `knowIt`)
   * fiszka przechodzi do Powtórki – pierwsza powtórka zawsze następnego dnia.
   */
  async rateLearn(card: Card, stars: Stars, today = toDay(), knowIt = false): Promise<{ streak: number; graduated: boolean }> {
    const { retention } = await this.getSettings();
    const next = review(card, stars, today, retention);
    const step = knowIt ? { streak: 3, graduated: true } : learnStep(card.learnStreak, stars);
    if (step.graduated) {
      const iv = GRADUATION_INTERVAL;
      await this.db.execute(
        `UPDATE cards SET repetitions = $1, interval = $2, stability = $3, difficulty = $4, lapses = $5,
                          due_date = $6, last_reviewed = $7, stage = 'review', learn_streak = 0, in_pool = 0,
                          learned_day = $8 WHERE id = $9`,
        [next.repetitions, iv, next.stability, next.difficulty, next.lapses, addDays(today, iv), today, today, card.id],
      );
    } else {
      await this.db.execute(
        `UPDATE cards SET repetitions = $1, interval = 0, stability = $2, difficulty = $3, lapses = $4,
                          due_date = $5, last_reviewed = $6, learn_streak = $7, in_pool = 1 WHERE id = $8`,
        [next.repetitions, next.stability, next.difficulty, next.lapses, today, today, step.streak, card.id],
      );
    }
    await this.saveRating(card, stars, today, "learn");
    return step;
  }

  async listTags(today = toDay()): Promise<TagInfo[]> {
    return this.db.select<TagInfo>(
      `SELECT t.name AS name, COUNT(c.id) AS count,
              SUM(CASE WHEN c.stage = 'review' AND c.due_date <= $1 AND c.suspended = 0 THEN 1 ELSE 0 END) AS due
       FROM tags t JOIN card_tags ct ON ct.tag_id = t.id JOIN cards c ON c.id = ct.card_id
       GROUP BY t.id ORDER BY t.name`,
      [today],
    );
  }

  /** Dni zaliczone do serii (wszystkie powtórki albo dość nowych fiszek). */
  async studyDays(): Promise<DayString[]> {
    const rows = await this.db.select<{ d: string }>(`SELECT day AS d FROM streak_days ORDER BY d`);
    return rows.map((r) => r.d);
  }

  /** Liczba powtórek w każdym dniu (do kalendarza aktywności). */
  async reviewsPerDay(): Promise<Record<DayString, number>> {
    const rows = await this.db.select<{ d: string; n: number }>(
      `SELECT review_day AS d, COUNT(*) AS n FROM reviews GROUP BY review_day`,
    );
    return Object.fromEntries(rows.map((r) => [r.d, Number(r.n)]));
  }

  /** Wszystkie oceny (do odtworzenia postępu sprzed tygodnia). */
  async reviewHistory(): Promise<ReviewRow[]> {
    const rows = await this.db.select<{ card_id: number; review_day: string; stars: number }>(
      `SELECT card_id, review_day, stars FROM reviews ORDER BY reviewed_at, id`,
    );
    return rows.map((r) => ({ cardId: Number(r.card_id), day: r.review_day, stars: Number(r.stars) as Stars }));
  }

  /** Znaczniki czasu ostatnich ocen (do oszacowania tempa nauki). */
  async recentReviewTimes(limit = 500): Promise<string[]> {
    const rows = await this.db.select<{ t: string }>(
      `SELECT reviewed_at AS t FROM reviews ORDER BY reviewed_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.t);
  }

  /** Ile powtórek przypada na kolejne dni (prognoza). Nowe fiszki z Nauki liczone dziś, w ramach dziennego limitu. */
  async forecast(today: DayString): Promise<Record<DayString, number>> {
    const rows = await this.db.select<{ d: string; n: number }>(
      `SELECT due_date AS d, COUNT(*) AS n FROM cards WHERE suspended = 0 AND stage = 'review' GROUP BY due_date`,
    );
    const out: Record<DayString, number> = {};
    for (const r of rows) {
      const d = r.d < today ? today : r.d;
      out[d] = (out[d] ?? 0) + Number(r.n);
    }
    const [fresh] = await this.db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM cards WHERE suspended = 0 AND stage = 'learn'`,
    );
    const remaining = await this.remainingNew(today);
    const n = remaining === null ? Number(fresh?.n ?? 0) : Math.min(remaining, Number(fresh?.n ?? 0));
    if (n > 0) out[today] = (out[today] ?? 0) + n;
    return out;
  }

  private async setTags(cardId: number, tags: string[]): Promise<void> {
    const names = [...new Set(tags.map(normalizeTag).filter(Boolean))];
    await this.db.execute(`DELETE FROM card_tags WHERE card_id = $1`, [cardId]);
    for (const name of names) {
      await this.db.execute(`INSERT OR IGNORE INTO tags (name) VALUES ($1)`, [name]);
      const [tag] = await this.db.select<{ id: number }>(`SELECT id FROM tags WHERE name = $1`, [name]);
      await this.db.execute(`INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES ($1, $2)`, [cardId, tag.id]);
    }
    await this.pruneTags();
  }

  private async pruneTags(): Promise<void> {
    await this.db.execute(`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM card_tags)`);
  }

  private async lastId(): Promise<number> {
    const [r] = await this.db.select<{ id: number }>(`SELECT MAX(id) AS id FROM cards`);
    return r.id;
  }
}

function rowToCard(r: CardRow): Card {
  return {
    id: r.id,
    question: r.question,
    answer: r.answer,
    repetitions: Number(r.repetitions),
    interval: Number(r.interval),
    stability: r.stability == null ? null : Number(r.stability),
    difficulty: r.difficulty == null ? null : Number(r.difficulty),
    lapses: Number(r.lapses ?? 0),
    dueDate: r.due_date,
    lastReviewed: r.last_reviewed,
    createdAt: r.created_at,
    suspended: Number(r.suspended ?? 0) === 1,
    tags: r.tags ? r.tags.split("|").sort() : [],
    avgStars: r.avg_stars == null ? null : Number(r.avg_stars),
    ratings: Number(r.ratings ?? 0),
    stage: r.stage === "review" ? "review" : "learn",
    learnStreak: Number(r.learn_streak ?? 0),
    inPool: Number(r.in_pool ?? 0) === 1,
  };
}
