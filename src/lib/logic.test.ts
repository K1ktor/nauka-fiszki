import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { addDays, diffDays } from "./dates";
import { initialState, nextInterval, replay, retrievability, review, SchedulingState, Stars } from "./scheduler";
import { computeStreak } from "./streak";
import { computeProgress, formatEta, lastWeeks, secondsPerCard } from "./progress";
import { poolAdditions, Store } from "./db";
import { backToLearn, breakAt, dayCompleted, GRADUATION_INTERVAL, insertRandom, learnStep, requeue, streakNewTarget } from "./learn";
import { sqlJsDriver } from "./drivers";

const T = "2026-11-17";

describe("algorytm powtórek (FSRS)", () => {
  const known = (stability: number, last = addDays(T, -10)): SchedulingState => ({
    stability, difficulty: 5, repetitions: 3, lapses: 0, interval: 10, dueDate: T, lastReviewed: last,
  });

  it("nowa fiszka: 1-2★ jutro, 3★ jutro, 4★ za 3 dni, 5★ za 16 dni", () => {
    const iv = ([1, 2, 3, 4, 5] as Stars[]).map((st) => review(initialState(T), st, T).interval);
    expect(iv).toEqual([1, 1, 1, 3, 16]);
  });

  it("1-2★ na znanej fiszce: powrót jutro, reset serii, spadek stabilności", () => {
    for (const st of [1, 2] as Stars[]) {
      const n = review(known(20), st, T);
      expect(n.interval).toBe(1);
      expect(n.dueDate).toBe(addDays(T, 1));
      expect(n.repetitions).toBe(0);
      expect(n.lapses).toBe(1);
      expect(n.stability!).toBeLessThan(20);
      expect(n.difficulty!).toBeGreaterThan(5);
    }
  });

  it("więcej gwiazdek = dłuższy odstęp", () => {
    const iv = ([1, 2, 3, 4, 5] as Stars[]).map((st) => review(known(10), st, T).interval);
    for (let i = 1; i < iv.length; i++) expect(iv[i]).toBeGreaterThanOrEqual(iv[i - 1]);
    expect(iv[4]).toBeGreaterThan(iv[3]);
    expect(iv[3]).toBeGreaterThan(iv[2]);
  });

  it("przy 90% odstęp = stabilność; wyższa skuteczność = krótszy odstęp", () => {
    expect(nextInterval(30, 0.9)).toBe(30);
    expect(retrievability(30, 30)).toBeCloseTo(0.9);
    expect(nextInterval(30, 0.95)).toBeLessThan(30);
    expect(nextInterval(30, 0.8)).toBeGreaterThan(30);
    expect(nextInterval(30, 2)).toBe(nextInterval(30, 0.99));
    const at = (r: number) => review(known(10), 4, T, r).interval;
    expect(at(0.95)).toBeLessThan(at(0.9));
    expect(at(0.8)).toBeGreaterThan(at(0.9));
  });

  it("seria czwórek rośnie szybko", () => {
    let s = initialState(T);
    const ivs: number[] = [];
    for (let i = 0; i < 5; i++) {
      s = review(s, 4, s.dueDate);
      ivs.push(s.interval);
    }
    for (let i = 1; i < ivs.length; i++) expect(ivs[i]).toBeGreaterThan(ivs[i - 1] * 2);
    expect(ivs[4]).toBeGreaterThan(100);
  });

  it("odtworzenie historii = kolejne oceny", () => {
    const hist = [
      { day: T, stars: 4 as Stars },
      { day: addDays(T, 3), stars: 5 as Stars },
      { day: addDays(T, 20), stars: 3 as Stars },
    ];
    let s = initialState(T);
    for (const h of hist) s = review(s, h.stars, h.day);
    expect(replay(hist, T)).toEqual(s);
    expect(diffDays(addDays(T, 20), s.dueDate)).toBe(s.interval);
  });
});

describe("CSV", () => {
  it("prosty format pytanie,odpowiedź z nagłówkiem", () => {
    const r = parseCsv("pytanie,odpowiedź\nStolica Polski?,Warszawa\n2+2,4\n");
    expect(r.cards).toEqual([
      { question: "Stolica Polski?", answer: "Warszawa", tags: [] },
      { question: "2+2", answer: "4", tags: [] },
    ]);
  });

  it("cudzysłowy, przecinki w polach, wiele linii, tagi", () => {
    const r = parseCsv('"Co to jest ""ATP""?","Nośnik energii, w komórce",biologia|Komórka\r\n"Wiersz\ndrugi",b\n');
    expect(r.cards[0]).toEqual({ question: 'Co to jest "ATP"?', answer: "Nośnik energii, w komórce", tags: ["biologia", "komórka"] });
    expect(r.cards[1].question).toBe("Wiersz\ndrugi");
  });

  it("średnik jako separator (Excel PL) i puste wiersze", () => {
    const r = parseCsv("a;b\n\nc;\nd;e;x\n");
    expect(r.delimiter).toBe(";");
    expect(r.cards.map((c) => c.question)).toEqual(["a", "d"]);
    expect(r.skipped).toEqual([{ line: 3, reason: "brak odpowiedzi" }]);
    expect(r.cards[1].tags).toEqual(["x"]);
  });
});

describe("streak", () => {
  it("liczy serię kończącą się dziś lub wczoraj", () => {
    const days = ["2026-11-10", "2026-11-11", "2026-11-14", "2026-11-15", "2026-11-16"];
    expect(computeStreak(days, T)).toEqual({ current: 3, best: 3, studiedToday: false });
    expect(computeStreak([...days, T], T)).toEqual({ current: 4, best: 4, studiedToday: true });
    expect(computeStreak(["2026-11-10", "2026-11-11"], T).current).toBe(0);
  });
});

describe("baza danych", () => {
  it("import, duplikaty, tagi, ocena, statystyki", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    const { cards } = parseCsv("Q1,A1,matma\nQ2,A2\nq1,inna\n");
    expect(await store.addCards(cards, ["Kurs"], T)).toMatchObject({ added: 2, duplicates: 1 });

    const all = await store.listCards();
    expect(all.find((c) => c.question === "Q1")?.tags).toEqual(["kurs", "matma"]);
    expect(all.every((c) => c.stage === "learn")).toBe(true);
    expect(await store.dueReviews(T)).toHaveLength(0);
    expect(await store.listTags(T)).toEqual([
      { name: "kurs", count: 2, due: 0 },
      { name: "matma", count: 1, due: 0 },
    ]);

    const q1 = all.find((c) => c.question === "Q1")!;
    expect(await store.rateLearn(q1, 5, T, true)).toEqual({ streak: 3, graduated: true });
    const after = (await store.listCards()).find((c) => c.id === q1.id)!;
    expect(after.stage).toBe("review");
    expect(after.dueDate).toBe(addDays(T, 1));
    expect(await store.dueReviews(addDays(T, 1), ["matma"])).toHaveLength(1);
    expect((await store.listTags(addDays(T, 1))).find((t) => t.name === "matma")?.due).toBe(1);

    await store.updateCard(q1.id, "Q1!", "A1!", ["fizyka"]);
    expect((await store.listTags(T)).map((t) => t.name)).toEqual(["fizyka", "kurs"]);
    await store.deleteCard(q1.id);
    expect(await store.listCards()).toHaveLength(1);
    expect((await store.listTags(T)).map((t) => t.name)).toEqual(["kurs"]);
  });

  it("usypianie, usuwanie wielu, nauka bez oceny, średnie gwiazdek", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    await store.init(); // migracja jest idempotentna
    await store.addCards(parseCsv("A,1,x\nB,2,x\nC,3,y\n").cards, [], T);
    const [c, b, a] = await store.listCards();
    await store.setSuspended([a.id, b.id], true);
    expect((await store.learnPool()).map((k) => k.question)).toEqual(["C"]);
    expect((await store.practiceCards(["x"]))).toHaveLength(0);
    expect((await store.listTags(T)).find((t) => t.name === "x")).toEqual({ name: "x", count: 2, due: 0 });
    expect((await store.listCards()).find((k) => k.question === "A")?.inPool).toBe(false);
    await store.setSuspended([a.id], false);
    expect((await store.practiceCards()).map((k) => k.question).sort()).toEqual(["A", "C"]);

    expect(await store.averageStars(T, T)).toEqual({ avg: null, count: 0 });
    await store.rateLearn(c, 5, addDays(T, -3));
    await store.rateLearn(a, 2, T);
    await store.rateLearn(c, 4, T);
    expect(await store.averageStars(T, T)).toEqual({ avg: 3, count: 2 });
    expect((await store.averageStars(addDays(T, -6), T)).avg).toBeCloseTo(11 / 3);

    // Średnia na fiszkę z całej historii ocen i filtr „poniżej X”.
    const byQ = Object.fromEntries((await store.listCards()).map((k) => [k.question, k]));
    expect(byQ.C.avgStars).toBe(4.5);
    expect(byQ.C.ratings).toBe(2);
    expect(byQ.A.avgStars).toBe(2);
    expect(byQ.B.avgStars).toBeNull();
    expect(byQ.B.ratings).toBe(0);
    const q = async (below: number | null, includeUnrated: boolean) =>
      (await store.practiceCards([], { below, includeUnrated })).map((k) => k.question).sort();
    expect(await q(null, false)).toEqual(["A", "C"]);
    expect(await q(2, true)).toEqual([]); // ściśle poniżej: 2★ już nie wchodzi
    expect(await q(2.5, true)).toEqual(["A"]);
    expect(await q(5, true)).toEqual(["A", "C"]);
    await store.setSuspended([b.id], false);
    expect(await q(2.5, true)).toEqual(["A", "B"]); // nieoceniona wchodzi
    expect(await q(2.5, false)).toEqual(["A"]);

    await store.deleteCards([a.id, b.id]);
    expect((await store.listCards()).map((k) => k.question)).toEqual(["C"]);
    expect((await store.listTags(T)).map((t) => t.name)).toEqual(["y"]);
  });

  it("ustawienia: limit nowych, wielkość puli", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    expect(await store.getSettings()).toEqual({ retention: 0.9, newPerDay: null, typeAnswer: false, poolSize: 20 });
    await store.saveSettings({ newPerDay: 2, typeAnswer: true, retention: 0.85, poolSize: 3 });
    expect(await store.getSettings()).toEqual({ retention: 0.85, newPerDay: 2, typeAnswer: true, poolSize: 5 });
    await store.saveSettings({ retention: 5, poolSize: 1000 });
    expect(await store.getSettings()).toMatchObject({ retention: 0.99, poolSize: 100 });
    await store.saveSettings({ newPerDay: null });
    expect((await store.getSettings()).newPerDay).toBeNull();
  });

  it("migracja z SM-2: odtworzenie historii, terminy nie są przyspieszane", async () => {
    const driver = await sqlJsDriver();
    // Baza w formacie 0.4.0.
    await driver.execute(`CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL,
      repetitions INTEGER NOT NULL DEFAULT 0, interval INTEGER NOT NULL DEFAULT 0, ease REAL NOT NULL DEFAULT 2.5,
      due_date TEXT NOT NULL, last_reviewed TEXT, created_at TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0)`);
    await driver.execute(`CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, stars INTEGER NOT NULL,
      review_day TEXT NOT NULL, reviewed_at TEXT NOT NULL)`);
    const d0 = "2026-01-01";
    const add = (q: string, due: string, last: string | null, rep: number, iv: number) =>
      driver.execute(`INSERT INTO cards (question, answer, repetitions, interval, ease, due_date, last_reviewed, created_at)
        VALUES ($1, 'x', $2, $3, 2.5, $4, $5, $6)`, [q, rep, iv, due, last, `${d0}T10:00:00.000Z`]);
    const rev = (id: number, stars: number, day: string) =>
      driver.execute(`INSERT INTO reviews (card_id, stars, review_day, reviewed_at) VALUES ($1, $2, $3, $4)`, [id, stars, day, `${day}T12:00:00.000Z`]);
    // 1: dobrze znana (same piątki) – SM-2 dał termin wcześniejszy niż FSRS.
    await add("znana", "2026-01-27", "2026-01-10", 3, 17);
    await rev(1, 5, d0); await rev(1, 5, "2026-01-04"); await rev(1, 5, "2026-01-10");
    // 2: termin z SM-2 późniejszy niż FSRS – zostaje.
    await add("odległa", "2027-01-01", "2026-01-02", 1, 364);
    await rev(2, 3, "2026-01-02");
    // 3: nowa, bez historii.
    await add("nowa", d0, null, 0, 0);

    const store = new Store(driver);
    await store.init();
    await store.init();
    const byQ = Object.fromEntries((await store.listCards()).map((k) => [k.question, k]));
    const expected = replay([{ day: d0, stars: 5 }, { day: "2026-01-04", stars: 5 }, { day: "2026-01-10", stars: 5 }], d0);
    expect(byQ.znana.stability).toBe(expected.stability);
    expect(byQ.znana.dueDate).toBe(expected.dueDate);
    expect(byQ.znana.dueDate > "2026-01-27").toBe(true);
    expect(byQ.odległa.dueDate).toBe("2027-01-01");
    expect(byQ.odległa.stability).not.toBeNull();
    expect(byQ.nowa.stability).toBeNull();
    expect(byQ.nowa.dueDate).toBe(d0);
    // 0.9.0: ostatnia ocena ≥4★ → Powtórka, reszta → Nauka; dotychczasowe dni zostają w serii.
    expect(byQ.znana.stage).toBe("review");
    expect(byQ.odległa.stage).toBe("learn");
    expect(byQ.nowa.stage).toBe("learn");
    expect(await store.studyDays()).toEqual([d0, "2026-01-02", "2026-01-04", "2026-01-10"]);
  });
});

describe("wpisywanie odpowiedzi", () => {
  it("porównanie odpowiedzi", async () => {
    const { compareAnswer } = await import("./answer");
    expect(compareAnswer("  warszawa. ", "Warszawa")).toBe("exact");
    expect(compareAnswer("Lodz", "Łódź")).toBe("close");
    expect(compareAnswer("Kraków", "Warszawa")).toBe("wrong");
    expect(compareAnswer("   ", "Warszawa")).toBe("empty");
  });
});

describe("eksport CSV", () => {
  it("eksport → import daje te same fiszki", async () => {
    const { toCsv } = await import("./csv");
    const cards = [
      { question: 'Co to "ATP"?', answer: "Nośnik energii, w komórce", tags: ["biologia", "komórka"] },
      { question: "Wiersz\ndrugi", answer: "a;b", tags: [] },
      { question: "2+2", answer: "4", tags: ["matma"] },
    ];
    const csv = toCsv(cards);
    expect(csv.startsWith("﻿pytanie,odpowiedź,tagi\r\n")).toBe(true);
    expect(parseCsv(csv).cards).toEqual(cards);
  });
});

describe("kreator", () => {
  it("fiszka i jej odwrotność", async () => {
    const { cardsFromDraft } = await import("./creator");
    expect(cardsFromDraft("  dog ", "pies", ["ang"], false)).toEqual([{ question: "dog", answer: "pies", tags: ["ang"] }]);
    expect(cardsFromDraft("dog", "pies", [], true)).toEqual([
      { question: "dog", answer: "pies", tags: [] },
      { question: "pies", answer: "dog", tags: [] },
    ]);
    expect(cardsFromDraft("", "pies", [], true)).toEqual([]);
    expect(cardsFromDraft("Echo", "echo", [], true)).toHaveLength(1);
  });

  it("przełączanie tagów w polu tekstowym", async () => {
    const { toggleTagText } = await import("./creator");
    expect(toggleTagText("", "ang")).toBe("ang");
    expect(toggleTagText("ang, rozdział 1", "Ang")).toBe("rozdział 1");
    expect(toggleTagText("ang|b", "c")).toBe("ang, b, c");
  });

  it("addCards zwraca id dodanych fiszek, pomija duplikat odwrotnej", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    await store.addCards([{ question: "pies", answer: "x", tags: [] }], [], T);
    const r = await store.addCards([{ question: "dog", answer: "pies", tags: [] }, { question: "pies", answer: "dog", tags: [] }], [], T);
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(1);
    const all = await store.listCards();
    expect(all.find((c) => c.id === r.ids[0])?.question).toBe("dog");
  });
});

describe("CSV z czatu AI", () => {
  it("odpowiedź w formacie z promptu, także w bloku kodu", () => {
    const out = '```csv\n"Stolica Francji?","Paryż","geografia|europa"\n"Co znaczy ""DNA""?","Kwas, deoksyrybonukleinowy","biologia"\n```\n';
    const r = parseCsv(out);
    expect(r.skipped).toEqual([]);
    expect(r.cards).toEqual([
      { question: "Stolica Francji?", answer: "Paryż", tags: ["geografia", "europa"] },
      { question: 'Co znaczy "DNA"?', answer: "Kwas, deoksyrybonukleinowy", tags: ["biologia"] },
    ]);
  });
});

describe("ekran powitalny", () => {
  it("tylko na pustej bazie i tylko raz", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    expect(await store.needsOnboarding()).toBe(true);
    await store.finishOnboarding("local");
    expect(await store.needsOnboarding()).toBe(false);

    const old = new Store(await sqlJsDriver());
    await old.init();
    await old.addCards([{ question: "a", answer: "b", tags: [] }], [], T);
    expect(await old.needsOnboarding()).toBe(false);
    expect(await old.needsOnboarding()).toBe(false);
  });
});

describe("postęp na ekranie Dziś", () => {
  it("dzieli fiszki na opanowane / w nauce / nowe i liczy przyrost z tygodnia", () => {
    const created = "2026-10-01T10:00:00";
    const cards = [
      { id: 1, interval: 30, lastReviewed: addDays(T, -1), createdAt: created },
      { id: 2, interval: 5, lastReviewed: addDays(T, -2), createdAt: created },
      { id: 3, interval: 0, lastReviewed: null, createdAt: created },
    ];
    // Fiszka 1 przed tygodniem miała tylko jedną ocenę (krótki odstęp), więc stała się opanowana w tym tygodniu.
    const reviews = [
      { cardId: 1, day: "2026-10-01", stars: 4 as Stars },
      { cardId: 1, day: addDays(T, -1), stars: 5 as Stars },
      { cardId: 2, day: addDays(T, -2), stars: 3 as Stars },
    ];
    expect(computeProgress(cards, reviews, T)).toEqual({ mastered: 1, learning: 1, fresh: 1, masteredThisWeek: 1 });
  });

  it("szacuje tempo z odstępów w sesji i formatuje czas", () => {
    const base = Date.parse("2026-11-17T10:00:00Z");
    const ts = [0, 10, 20, 30, 40, 50, 3600].map((s) => new Date(base + s * 1000).toISOString());
    expect(secondsPerCard(ts)).toBe(10);
    expect(secondsPerCard([])).toBe(15);
    expect(formatEta(24, 15)).toBe("ok. 6 min");
    expect(formatEta(400, 15)).toBe("ok. 1 h 40 min");
  });

  it("ostatnie 4 tygodnie zaczynają się w poniedziałek i obejmują dziś", () => {
    const w = lastWeeks(T, 4);
    expect(w).toHaveLength(4);
    expect(w[0][0]).toBe("2026-10-26");
    expect(w.flat()).toContain(T);
  });

  it("baza zwraca historię ocen i czasy", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    await store.addCards(parseCsv("A,B\n").cards, [], T);
    const [c] = await store.listCards();
    await store.rateLearn(c, 4, T);
    expect(await store.reviewHistory()).toEqual([{ cardId: c.id, day: T, stars: 4 }]);
    expect(await store.recentReviewTimes()).toHaveLength(1);
  });
});

describe("tryb Nauka", () => {
  it("kółka: 4–5★ dolicza, 3★ nic nie zmienia, 1–2★ zeruje; 3 z rzędu = Powtórka", () => {
    expect(learnStep(0, 4)).toEqual({ streak: 1, graduated: false });
    expect(learnStep(1, 5)).toEqual({ streak: 2, graduated: false });
    expect(learnStep(2, 3)).toEqual({ streak: 2, graduated: false });
    expect(learnStep(2, 2)).toEqual({ streak: 0, graduated: false });
    expect(learnStep(1, 1)).toEqual({ streak: 0, graduated: false });
    expect(learnStep(2, 4)).toEqual({ streak: 3, graduated: true });
    expect(GRADUATION_INTERVAL).toBe(1);
    expect(backToLearn(1)).toBe(true);
    expect(backToLearn(2)).toBe(false);
    expect(backToLearn(3)).toBe(false);
  });

  it("im wyższa ocena, tym później fiszka wraca w sesji", () => {
    const q = Array.from({ length: 20 }, (_, i) => i);
    const pos = (stars: 1 | 2 | 3 | 4 | 5) => requeue(q, stars).indexOf(0);
    expect(pos(1)).toBeLessThan(pos(3));
    expect(pos(2)).toBeLessThan(pos(3));
    expect(pos(3)).toBeLessThan(pos(4));
    expect(pos(4)).toBeLessThan(pos(5));
    expect(requeue([7, 8], 5)).toEqual([8, 7]); // krótka kolejka: na koniec
    expect(requeue(q, 3)).toHaveLength(20);
    expect(insertRandom([1, 2, 3], 9, () => 0)).toEqual([1, 9, 2, 3]); // nigdy na sam początek
    expect(insertRandom([], 9)).toEqual([9]);
  });

  it("seria dnia i okienko „pora odpocząć”", () => {
    expect(streakNewTarget(null)).toBe(10);
    expect(streakNewTarget(20)).toBe(10);
    expect(streakNewTarget(5)).toBe(5);
    expect(dayCompleted({ reviewsDone: 3, reviewsLeft: 0, learned: 0, target: 10 })).toBe(true);
    expect(dayCompleted({ reviewsDone: 3, reviewsLeft: 1, learned: 0, target: 10 })).toBe(false);
    expect(dayCompleted({ reviewsDone: 0, reviewsLeft: 0, learned: 0, target: 10 })).toBe(false); // nic nie zrobiono
    expect(dayCompleted({ reviewsDone: 0, reviewsLeft: 5, learned: 10, target: 10 })).toBe(true);
    expect(breakAt(null)).toBeNull();
    expect(breakAt(20)).toBe(20);
    expect(breakAt(20, 20)).toBe(30);
    expect(breakAt(20, 31)).toBe(41);
  });

  it("pula: dopełnianie do rozmiaru tylko fiszkami z Nauki i z wybranych tagów", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    const csv = Array.from({ length: 30 }, (_, i) => `Q${i},A${i},${i < 10 ? "a" : "b"}`).join("\n");
    await store.addCards(parseCsv(csv).cards, [], T);
    await store.saveSettings({ poolSize: 5 });

    const a = await store.learnPool(["a"]);
    expect(a).toHaveLength(5);
    expect(a.every((c) => c.tags.includes("a") && c.inPool)).toBe(true);
    // Pula zapisuje się: ponowne otwarcie daje te same fiszki.
    expect((await store.learnPool(["a"])).map((c) => c.id).sort()).toEqual(a.map((c) => c.id).sort());
    // Inne tagi = osobne 5 fiszek; „wszystkie” widzi już 10 z puli.
    expect(await store.learnPool(["b"])).toHaveLength(5);
    expect(await store.learnPool()).toHaveLength(10);

    // Nauczona fiszka opuszcza pulę, wchodzi kolejna.
    const first = a[0];
    for (const s of [4, 5] as Stars[]) await store.rateLearn({ ...first, learnStreak: s === 4 ? 0 : 1 }, s, T);
    let c = (await store.listCards()).find((k) => k.id === first.id)!;
    expect(c.learnStreak).toBe(2);
    expect(c.stage).toBe("learn");
    expect(await store.rateLearn(c, 5, T)).toEqual({ streak: 3, graduated: true });
    c = (await store.listCards()).find((k) => k.id === first.id)!;
    expect(c).toMatchObject({ stage: "review", inPool: false, dueDate: addDays(T, 1), learnStreak: 0 });
    const a2 = await store.learnPool(["a"]);
    expect(a2).toHaveLength(5);
    expect(a2.map((k) => k.id)).not.toContain(first.id);
    expect(await store.learnedToday(T)).toBe(1);

    // poolAdditions: nic, gdy pula pełna; brak kandydatów = brak dopisanych.
    const all = await store.listCards();
    expect(poolAdditions(all, ["a"], 5)).toEqual([]);
    expect(poolAdditions(all, ["a"], 50)).toHaveLength(4); // 10 w tagu − 1 nauczona − 5 w puli
  });

  it("Powtórka: 2★ zostaje z odstępem 1 dnia, 3★ krótszy niż 5★, tylko 1★ wraca do Nauki", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    await store.addCards(parseCsv("A,1\nB,2\nC,3\nD,4\n").cards, [], T);
    for (const k of await store.listCards()) await store.rateLearn(k, 4, T, true);
    const day = addDays(T, 1);
    const due = await store.dueReviews(day);
    expect(due).toHaveLength(4);
    const [w, x, y, z] = due;
    const barely = await store.rateReview(w, 2, day);
    const hard = await store.rateReview(x, 3, day);
    const good = await store.rateReview(y, 5, day);
    expect(barely.backToLearn).toBe(false);
    expect(barely.interval).toBe(1);
    expect(barely.dueDate).toBe(addDays(day, 1));
    expect(barely.interval).toBeLessThanOrEqual(hard.interval);
    expect(hard.backToLearn).toBe(false);
    expect(hard.interval).toBeLessThan(good.interval);
    const lapse = await store.rateReview({ ...z, learnStreak: 2 }, 1, day);
    expect(lapse.backToLearn).toBe(true);
    const byId = Object.fromEntries((await store.listCards()).map((k) => [k.id, k]));
    expect(byId[w.id].stage).toBe("review");
    expect(byId[x.id].stage).toBe("review");
    expect(byId[z.id]).toMatchObject({ stage: "learn", learnStreak: 0, inPool: true });
    expect(await store.dueReviews(day)).toHaveLength(0);
  });

  it("przejście do Powtórki: pierwsza powtórka zawsze jutro (4★, 5★ i „To już umiem”)", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    await store.addCards(parseCsv("A,1\nB,2\nC,3\n").cards, [], T);
    const [a, b, c] = await store.listCards();
    await store.rateLearn({ ...a, learnStreak: 2 }, 4, T);
    await store.rateLearn({ ...b, learnStreak: 2 }, 5, T);
    await store.rateLearn(c, 5, T, true);
    for (const k of await store.listCards()) expect(k).toMatchObject({ stage: "review", dueDate: addDays(T, 1), interval: 1 });
  });

  it("seria: wszystkie powtórki na dziś albo X nowych", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    await store.addCards(parseCsv(Array.from({ length: 12 }, (_, i) => `Q${i},A`).join("\n")).cards, [], T);
    await store.saveSettings({ newPerDay: 3 });
    expect(await store.markStreakDay(T)).toBe(false); // nic jeszcze nie zrobiono
    const cards = await store.listCards();
    for (const k of cards.slice(0, 2)) await store.rateLearn(k, 5, T, true);
    expect(await store.markStreakDay(T)).toBe(false);
    await store.rateLearn(cards[2], 5, T, true);
    expect(await store.markStreakDay(T)).toBe(true); // 3 = min(10, limit 3)
    expect(await store.studyDays()).toEqual([T]);

    // Następnego dnia: powtórki (jutro) – wszystkie zrobione = dzień zaliczony.
    const day = addDays(T, 1);
    const due = await store.dueReviews(day);
    expect(due).toHaveLength(3);
    await store.rateReview(due[0], 4, day);
    expect(await store.markStreakDay(day)).toBe(false);
    for (const k of due.slice(1)) await store.rateReview(k, 4, day);
    expect(await store.markStreakDay(day)).toBe(true);
    expect(await store.studyDays()).toEqual([T, day]);
  });
});
