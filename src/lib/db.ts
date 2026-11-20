import { DayString, toDay } from "./dates";
import { ParsedCard, normalizeTag } from "./csv";
import { SchedulingState, Stars, initialState, review } from "./scheduler";

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
  lastReviewed: DayString | null;
  /** Uśpiona fiszka nie pojawia się w sesjach nauki. */
  suspended: boolean;
  /** Średnia gwiazdek ze wszystkich ocen tej fiszki (null = jeszcze nieoceniona). */
  avgStars: number | null;
  /** Ile razy fiszka została oceniona. */
  ratings: number;
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

export interface TagInfo {
  name: string;
  count: number;
  due: number;
}

export interface ImportResult {
  added: number;
  duplicates: number;
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
];

interface CardRow {
  id: number;
  question: string;
  answer: string;
  repetitions: number;
  interval: number;
  ease: number;
  due_date: string;
  last_reviewed: string | null;
  created_at: string;
  suspended: number;
  tags: string | null;
  avg_stars: number | null;
  ratings: number;
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

  /** Karty do powtórki na dziś (zaległe też), opcjonalnie tylko z wybranych tagów. */
  async dueCards(today: DayString, tags: string[] = []): Promise<Card[]> {
    const all = await this.listCards();
    return all
      .filter((c) => !c.suspended && c.dueDate <= today)
      .filter((c) => tags.length === 0 || c.tags.some((t) => tags.includes(t)))
      .sort((a, b) => (a.dueDate === b.dueDate ? a.id - b.id : a.dueDate < b.dueDate ? -1 : 1));
  }

  async addCards(cards: ParsedCard[], extraTags: string[] = [], today = toDay()): Promise<ImportResult> {
    const existing = new Set(
      (await this.db.select<{ question: string }>(`SELECT question FROM cards`)).map((r) => r.question.toLowerCase()),
    );
    let added = 0;
    let duplicates = 0;
    const init = initialState(today);
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
        [c.question.trim(), c.answer.trim(), init.repetitions, init.interval, init.ease, init.dueDate, new Date().toISOString()],
      );
      const id = res.lastInsertId ?? (await this.lastId());
      await this.setTags(id, [...c.tags, ...extraTags]);
      added++;
    }
    return { added, duplicates };
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

  /** Zapisuje ocenę i wyznacza kolejny dzień pokazu. Zwraca nowy stan karty. */
  async rateCard(card: Card, stars: Stars, today = toDay()): Promise<SchedulingState> {
    const next = review(card, stars, today);
    await this.db.execute(
      `UPDATE cards SET repetitions = $1, interval = $2, ease = $3, due_date = $4, last_reviewed = $5 WHERE id = $6`,
      [next.repetitions, next.interval, next.ease, next.dueDate, today, card.id],
    );
    await this.db.execute(
      `INSERT INTO reviews (card_id, stars, review_day, reviewed_at) VALUES ($1, $2, $3, $4)`,
      [card.id, stars, today, new Date().toISOString()],
    );
    return next;
  }

  async listTags(today = toDay()): Promise<TagInfo[]> {
    return this.db.select<TagInfo>(
      `SELECT t.name AS name, COUNT(c.id) AS count,
              SUM(CASE WHEN c.due_date <= $1 AND c.suspended = 0 THEN 1 ELSE 0 END) AS due
       FROM tags t JOIN card_tags ct ON ct.tag_id = t.id JOIN cards c ON c.id = ct.card_id
       GROUP BY t.id ORDER BY t.name`,
      [today],
    );
  }

  async studyDays(): Promise<DayString[]> {
    const rows = await this.db.select<{ d: string }>(`SELECT DISTINCT review_day AS d FROM reviews ORDER BY d`);
    return rows.map((r) => r.d);
  }

  /** Liczba powtórek w każdym dniu (do kalendarza aktywności). */
  async reviewsPerDay(): Promise<Record<DayString, number>> {
    const rows = await this.db.select<{ d: string; n: number }>(
      `SELECT review_day AS d, COUNT(*) AS n FROM reviews GROUP BY review_day`,
    );
    return Object.fromEntries(rows.map((r) => [r.d, Number(r.n)]));
  }

  /** Ile kart przypada na kolejne dni (prognoza). */
  async forecast(today: DayString): Promise<Record<DayString, number>> {
    const rows = await this.db.select<{ d: string; n: number }>(
      `SELECT due_date AS d, COUNT(*) AS n FROM cards WHERE suspended = 0 GROUP BY due_date`,
    );
    const out: Record<DayString, number> = {};
    for (const r of rows) {
      const d = r.d < today ? today : r.d;
      out[d] = (out[d] ?? 0) + Number(r.n);
    }
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
    ease: Number(r.ease),
    dueDate: r.due_date,
    lastReviewed: r.last_reviewed,
    createdAt: r.created_at,
    suspended: Number(r.suspended ?? 0) === 1,
    tags: r.tags ? r.tags.split("|").sort() : [],
    avgStars: r.avg_stars == null ? null : Number(r.avg_stars),
    ratings: Number(r.ratings ?? 0),
  };
}
