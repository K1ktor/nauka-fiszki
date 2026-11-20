import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { addDays, diffDays } from "./dates";
import { initialState, review, Stars } from "./scheduler";
import { computeStreak } from "./streak";
import { Store } from "./db";
import { sqlJsDriver } from "./drivers";

const T = "2026-11-17";

describe("algorytm powtórek", () => {
  it("1-2 gwiazdki: powtórka jutro i reset", () => {
    const s = { repetitions: 4, interval: 20, ease: 2.5, dueDate: T };
    for (const st of [1, 2] as Stars[]) {
      const n = review(s, st, T);
      expect(n.interval).toBe(1);
      expect(n.repetitions).toBe(0);
      expect(n.dueDate).toBe(addDays(T, 1));
      expect(n.ease).toBeLessThan(2.5);
    }
  });

  it("więcej gwiazdek = dłuższy odstęp", () => {
    const s = { repetitions: 3, interval: 10, ease: 2.5, dueDate: T };
    const iv = ([1, 2, 3, 4, 5] as Stars[]).map((st) => review(s, st, T).interval);
    for (let i = 1; i < iv.length; i++) expect(iv[i]).toBeGreaterThanOrEqual(iv[i - 1]);
    expect(iv[4]).toBeGreaterThan(iv[2]);
  });

  it("seria piątek rośnie wykładniczo", () => {
    let s = initialState(T);
    const ivs: number[] = [];
    let day = T;
    for (let i = 0; i < 5; i++) {
      s = review(s, 5, day);
      ivs.push(s.interval);
      day = s.dueDate;
    }
    expect(ivs).toEqual([3, 6, 17, 49, 147]);
    expect(diffDays(T, s.dueDate)).toBe(3 + 6 + 17 + 49 + 147);
  });

  it("łatwość nie spada poniżej 1.3", () => {
    let s = initialState(T);
    for (let i = 0; i < 20; i++) s = review(s, 1, T);
    expect(s.ease).toBe(1.3);
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
    expect(await store.addCards(cards, ["Kurs"], T)).toEqual({ added: 2, duplicates: 1 });

    const all = await store.listCards();
    expect(all.find((c) => c.question === "Q1")?.tags).toEqual(["kurs", "matma"]);
    expect(await store.dueCards(T, ["matma"])).toHaveLength(1);
    expect(await store.listTags(T)).toEqual([
      { name: "kurs", count: 2, due: 2 },
      { name: "matma", count: 1, due: 1 },
    ]);

    const q1 = all.find((c) => c.question === "Q1")!;
    const next = await store.rateCard(q1, 4, T);
    expect(next.dueDate).toBe(addDays(T, 2));
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

    await store.deleteCards([a.id, b.id]);
    expect((await store.listCards()).map((k) => k.question)).toEqual(["C"]);
    expect((await store.listTags(T)).map((t) => t.name)).toEqual(["y"]);
  });
});
