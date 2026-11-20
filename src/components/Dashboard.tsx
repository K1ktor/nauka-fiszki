import { useEffect, useState } from "react";
import { buildQueue, Card, isNew, Store, TagInfo } from "../lib/db";
import { addDays, parseDay, toDay } from "../lib/dates";
import { computeStreak, StreakInfo } from "../lib/streak";

interface Props {
  store: Store;
  version: number;
  onStart: (tags: string[]) => void;
  onImport: () => void;
}

interface Data {
  cards: Card[];
  tags: TagInfo[];
  streak: StreakInfo;
  perDay: Record<string, number>;
  forecast: Record<string, number>;
  avgToday: { avg: number | null; count: number };
  avgWeek: { avg: number | null; count: number };
  remainingNew: number | null;
}

const WEEKS = 18;
const DOW = ["Pn", "", "Śr", "", "Pt", "", ""];

export default function Dashboard({ store, version, onStart, onImport }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const today = toDay();

  useEffect(() => {
    (async () => {
      const [cards, tags, days, perDay, forecast, avgToday, avgWeek, remainingNew] = await Promise.all([
        store.listCards(),
        store.listTags(today),
        store.studyDays(),
        store.reviewsPerDay(),
        store.forecast(today),
        store.averageStars(today, today),
        store.averageStars(addDays(today, -6), today),
        store.remainingNew(today),
      ]);
      setData({ cards, tags, streak: computeStreak(days, today), perDay, forecast, avgToday, avgWeek, remainingNew });
    })();
  }, [store, version, today]);

  if (!data) return null;
  const { cards, tags, streak, perDay, forecast, avgToday, avgWeek, remainingNew } = data;

  const dueAll = buildQueue(cards, today, [], remainingNew);
  const fmtAvg = (a: { avg: number | null }) => (a.avg === null ? "–" : a.avg.toFixed(1).replace(".", ","));
  const due = selected.length ? buildQueue(cards, today, selected, remainingNew) : dueAll;
  const newCount = due.filter(isNew).length;
  const reviewedToday = perDay[today] ?? 0;
  const toggle = (t: string) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  if (cards.length === 0) {
    return (
      <div className="empty">
        <h1>Witaj! 👋</h1>
        <p className="muted">Nie masz jeszcze żadnych fiszek. Zaimportuj plik CSV w formacie <code>pytanie,odpowiedź</code>, aby zacząć.</p>
        <button className="primary big" onClick={onImport}>Importuj fiszki z CSV</button>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <h1>Dziś</h1>
      <div className="stats">
        <div className={`stat streak ${streak.studiedToday ? "lit" : ""}`}>
          <div className="stat-value">🔥 {streak.current}</div>
          <div className="stat-label">
            {streak.current === 1 ? "dzień" : "dni"} z rzędu
            <span className="muted"> · rekord {streak.best}</span>
          </div>
          {!streak.studiedToday && streak.current > 0 && <div className="warn">Ucz się dziś, aby nie stracić serii!</div>}
        </div>
        <div className="stat">
          <div className="stat-value">{dueAll.length}</div>
          <div className="stat-label">do powtórki dziś</div>
        </div>
        <div className="stat">
          <div className="stat-value">{reviewedToday}</div>
          <div className="stat-label">powtórzonych dziś</div>
        </div>
        <div className="stat avg">
          <div className="stat-value">
            <span className="avg-star">★</span> {fmtAvg(avgToday)}
            <span className="avg-week"> / {fmtAvg(avgWeek)}</span>
          </div>
          <div className="stat-label">
            średnia ocen: dziś / 7 dni
          </div>
        </div>
        <div className="stat">
          <div className="stat-value">{cards.length}</div>
          <div className="stat-label">fiszek łącznie</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Rozpocznij naukę</h2>
          {selected.length > 0 && <button className="link" onClick={() => setSelected([])}>wyczyść filtr</button>}
        </div>
        {tags.length > 0 && (
          <div className="chips">
            {tags.map((t) => (
              <button key={t.name} className={selected.includes(t.name) ? "chip on" : "chip"} onClick={() => toggle(t.name)}>
                #{t.name} <span className="chip-count">{buildQueue(cards, today, [t.name], remainingNew).length}/{t.count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="start-row">
          <button className="primary big" disabled={due.length === 0} onClick={() => onStart(selected)}>
            {due.length > 0 ? `Ucz się (${due.length})` : "Wszystko powtórzone 🎉"}
          </button>
          {due.length > 0 && <span className="muted">{newCount} nowych · {due.length - newCount} powtórek</span>}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>Aktywność</h2>
          <Heatmap perDay={perDay} today={today} />
        </section>
        <section className="panel">
          <h2>Najbliższe 7 dni</h2>
          <Forecast forecast={forecast} today={today} />
        </section>
      </div>
    </div>
  );
}

function Heatmap({ perDay, today }: { perDay: Record<string, number>; today: string }) {
  // Kolumny = tygodnie (od poniedziałku), ostatnia kolumna zawiera dzisiejszy dzień.
  const dow = (parseDay(today).getDay() + 6) % 7;
  const start = addDays(today, -dow - (WEEKS - 1) * 7);
  const cols: string[][] = [];
  for (let w = 0; w < WEEKS; w++) cols.push(Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const level = (n: number) => (n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4);
  return (
    <div className="heatmap">
      <div className="heat-dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
      {cols.map((col, i) => (
        <div key={i} className="heat-col">
          {col.map((d) => {
            const n = perDay[d] ?? 0;
            return <span key={d} className={`cell l${d > today ? "x" : level(n)}`} title={`${d}: ${n} powtórek`} />;
          })}
        </div>
      ))}
    </div>
  );
}

function Forecast({ forecast, today }: { forecast: Record<string, number>; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const max = Math.max(1, ...days.map((d) => forecast[d] ?? 0));
  const name = (d: string, i: number) =>
    i === 0 ? "dziś" : i === 1 ? "jutro" : parseDay(d).toLocaleDateString("pl-PL", { weekday: "short" });
  return (
    <div className="forecast">
      {days.map((d, i) => {
        const n = forecast[d] ?? 0;
        return (
          <div key={d} className="bar-wrap" title={`${d}: ${n}`}>
            <span className="bar-n">{n}</span>
            <div className="bar" style={{ height: `${(n / max) * 100}%` }} />
            <span className="bar-label">{name(d, i)}</span>
          </div>
        );
      })}
    </div>
  );
}
