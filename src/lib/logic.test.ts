import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { addDays, diffDays } from "./dates";
import { initialState, nextInterval, replay, retrievability, review, SchedulingState, Stars } from "./scheduler";
import { computeStreak } from "./streak";
import { Store } from "./db";
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
    expect(await store.dueCards(T, ["matma"])).toHaveLength(1);
    expect(await store.listTags(T)).toEqual([
      { name: "kurs", count: 2, due: 2 },
      { name: "matma", count: 1, due: 1 },
    ]);

    const q1 = all.find((c) => c.question === "Q1")!;
    const next = await store.rateCard(q1, 4, T);
    expect(next.dueDate).toBe(addDays(T, 3));
    expect(await store.dueCards(T)).toHaveLength(1);
    expect(await store.studyDays()).toEqual([T]);

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
    expect((await store.dueCards(T)).map((k) => k.question)).toEqual(["C"]);
    expect((await store.practiceCards(["x"]))).toHaveLength(0);
    expect((await store.listTags(T)).find((t) => t.name === "x")).toEqual({ name: "x", count: 2, due: 0 });
    await store.setSuspended([a.id], false);
    expect((await store.practiceCards()).map((k) => k.question).sort()).toEqual(["A", "C"]);

    expect(await store.averageStars(T, T)).toEqual({ avg: null, count: 0 });
    await store.rateCard(c, 5, addDays(T, -3));
    await store.rateCard(a, 2, T);
    await store.rateCard(c, 4, T);
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

  it("limit nowych fiszek dziennie, powtórki bez limitu, ustawienia", async () => {
    const store = new Store(await sqlJsDriver());
    await store.init();
    expect(await store.getSettings()).toEqual({ retention: 0.9, newPerDay: null, typeAnswer: false });
    await store.addCards(parseCsv("A,1\nB,2\nC,3\nD,4\nE,5\n").cards, [], addDays(T, -5));
    // Dwie fiszki powtórzone wcześniej i zaległe dziś.
    const byQ = async () => Object.fromEntries((await store.listCards()).map((k) => [k.question, k]));
    let q = await byQ();
    await store.rateCard(q.D, 3, addDays(T, -5));
    await store.rateCard(q.E, 3, addDays(T, -5));

    await store.saveSettings({ newPerDay: 2, typeAnswer: true, retention: 0.85 });
    expect(await store.getSettings()).toEqual({ retention: 0.85, newPerDay: 2, typeAnswer: true });
    expect((await store.dueCards(T)).map((k) => k.question)).toEqual(["D", "E", "A", "B"]);

    q = await byQ();
    await store.rateCard(q.A, 4, T);
    expect(await store.newStudiedToday(T)).toBe(1);
    expect((await store.dueCards(T)).map((k) => k.question)).toEqual(["D", "E", "B"]);
    await store.rateCard(q.D, 4, T); // powtórka nie zużywa limitu nowych
    expect((await store.dueCards(T)).map((k) => k.question)).toEqual(["E", "B"]);

    await store.saveSettings({ newPerDay: 0 });
    expect((await store.dueCards(T)).map((k) => k.question)).toEqual(["E"]);
    await store.saveSettings({ newPerDay: null });
    expect((await store.dueCards(T)).map((k) => k.question)).toEqual(["E", "B", "C"]);
    await store.saveSettings({ retention: 5 });
    expect((await store.getSettings()).retention).toBe(0.99);
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
