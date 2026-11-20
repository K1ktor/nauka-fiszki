import { useEffect, useMemo, useState } from "react";
import { buildQueue, Card, isNew, Store, TagInfo } from "../lib/db";
import { addDays, parseDay, toDay } from "../lib/dates";
import { computeStreak, StreakInfo } from "../lib/streak";
import { computeProgress, formatEta, lastWeeks, MASTERED_DAYS, ProgressInfo, secondsPerCard } from "../lib/progress";

interface Props {
  store: Store;
  version: number;
  onStart: (tags: string[]) => void;
  onImport: () => void;
  onCreate: () => void;
}

interface Data {
  cards: Card[];
  tags: TagInfo[];
  streak: StreakInfo;
  perDay: Record<string, number>;
  forecast: Record<string, number>;
  avgWeek: { avg: number | null; count: number };
  remainingNew: number | null;
  progress: ProgressInfo;
  perCard: number;
}

/** Ile tygodni pokazuje szachownica aktywności. */
const WEEKS = 4;
/** Ile tagów widać bez rozwijania listy. */
const TOP_TAGS = 6;
const DOW = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

/** Polska odmiana: 1 fiszka, 2–4 fiszki, 5+ fiszek. */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

export default function Dashboard({ store, version, onStart, onImport, onCreate }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [allTags, setAllTags] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const today = toDay();

  useEffect(() => {
    (async () => {
      const [cards, tags, days, perDay, forecast, avgWeek, remainingNew, history, times, settings] = await Promise.all([
        store.listCards(),
        store.listTags(today),
        store.studyDays(),
        store.reviewsPerDay(),
        store.forecast(today),
        store.averageStars(addDays(today, -6), today),
        store.remainingNew(today),
        store.reviewHistory(),
        store.recentReviewTimes(),
        store.getSettings(),
      ]);
      setData({
        cards,
        tags,
        streak: computeStreak(days, today),
        perDay,
        forecast,
        avgWeek,
        remainingNew,
        progress: computeProgress(cards, history, today, settings.retention),
        perCard: secondsPerCard(times),
      });
    })();
  }, [store, version, today]);

  // Tagi posortowane wg liczby fiszek na dziś (potem alfabetycznie).
  const tagRows = useMemo(() => {
    if (!data) return [];
    return data.tags
      .map((t) => ({ ...t, queue: buildQueue(data.cards, today, [t.name], data.remainingNew).length }))
      .sort((a, b) => b.queue - a.queue || a.name.localeCompare(b.name, "pl"));
  }, [data, today]);

  if (!data) return null;
  const { cards, streak, perDay, forecast, avgWeek, remainingNew, progress, perCard } = data;

  if (cards.length === 0) {
    return (
      <div className="empty">
        <h1>Witaj! 👋</h1>
        <p className="muted">Nie masz jeszcze żadnych fiszek. Dodaj je po kolei w kreatorze albo zaimportuj plik CSV w formacie <code>pytanie,odpowiedź</code>.</p>
        <div className="start-row">
          <button className="primary big" onClick={onCreate}>✍️ Otwórz kreator</button>
          <button className="big" onClick={onImport}>📄 Importuj z CSV</button>
        </div>
      </div>
    );
  }

  const dueAll = buildQueue(cards, today, [], remainingNew);
  const due = selected.length ? buildQueue(cards, today, selected, remainingNew) : dueAll;
  const newCount = due.filter(isNew).length;
  const reviewedToday = perDay[today] ?? 0;
  const plan = reviewedToday + dueAll.length;
  const toggle = (t: string) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const fmtAvg = (a: number | null) => (a === null ? "–" : a.toFixed(1).replace(".", ","));
  const dateLabel = parseDay(today).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });

  const q = tagQuery.trim().toLowerCase();
  const shownTags = allTags
    ? tagRows.filter((t) => !q || t.name.toLowerCase().includes(q))
    : tagRows.filter((t, i) => i < TOP_TAGS || selected.includes(t.name));
  const hiddenCount = tagRows.length - shownTags.length;

  return (
    <div className="dashboard">
      <h1 className="dash-title">Dziś</h1>
      <p className="muted dash-date">{dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}</p>

      <section className="panel plan">
        <PlanRing done={reviewedToday} total={plan} />
        <div className="plan-body">
          <h2 className="plan-title">
            {due.length > 0
              ? `${reviewedToday > 0 ? "Zostało" : "Na dziś"} ${due.length} ${plural(due.length, "fiszka", "fiszki", "fiszek")} · ${formatEta(due.length, perCard)}`
              : plan > 0
                ? "Plan na dziś zrobiony 🎉"
                : "Na dziś nic nie zaplanowano 🎉"}
          </h2>
          {due.length > 0 && <div className="muted">{newCount} nowych · {due.length - newCount} powtórek</div>}
          {tagRows.length > 0 && dueAll.length > 0 && (
            <>
              {allTags && tagRows.length > TOP_TAGS && (
                <input className="tag-search" placeholder="Szukaj tagu…" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} autoFocus />
              )}
              <div className={allTags ? "chips chips-scroll" : "chips"}>
                {shownTags.map((t) => (
                  <button key={t.name} className={selected.includes(t.name) ? "chip on" : "chip"} onClick={() => toggle(t.name)}>
                    #{t.name} <span className="chip-count">{t.queue}/{t.count}</span>
                  </button>
                ))}
                {!allTags && hiddenCount > 0 && (
                  <button className="chip more" onClick={() => setAllTags(true)}>+{hiddenCount} {plural(hiddenCount, "tag", "tagi", "tagów")} ▾</button>
                )}
                {allTags && (
                  <button className="chip more" onClick={() => { setAllTags(false); setTagQuery(""); }}>zwiń ▴</button>
                )}
                {selected.length > 0 && <button className="link chip-clear" onClick={() => setSelected([])}>wyczyść filtr</button>}
              </div>
            </>
          )}
          <div className="start-row">
            <button className="primary big" disabled={due.length === 0} onClick={() => onStart(selected)}>
              {due.length > 0 ? `${reviewedToday > 0 ? "Ucz się dalej" : "Ucz się"} (${due.length})` : "Wszystko powtórzone 🎉"}
            </button>
          </div>
        </div>
      </section>

      <div className="two-col dash-grid">
        <div className="dash-col">
          <section className="panel">
            <div className="panel-head">
              <h2>Seria</h2>
              <span className="muted">rekord {streak.best}</span>
            </div>
            <div className="streak-row">
              <div className={`streak-info ${streak.studiedToday ? "lit" : ""}`}>
                <div className="streak-n"><span className="streak-fire">🔥</span> {streak.current}</div>
                <div className="streak-label muted">{streak.current === 1 ? "dzień" : "dni"} z rzędu</div>
                <div className="streak-note muted">
                  {streak.studiedToday
                    ? "Dzisiejszy dzień zaliczony ✓"
                    : streak.current > 0
                      ? <span className="warn">Ucz się dziś, aby nie stracić serii!</span>
                      : "Zacznij dziś nową serię."}
                  {streak.studiedToday && streak.best > streak.current && (
                    <><br />Do rekordu brakuje {streak.best - streak.current} {plural(streak.best - streak.current, "dzień", "dni", "dni")}.</>
                  )}
                  {streak.studiedToday && streak.current > 1 && streak.current === streak.best && <><br />To Twój rekord! 🏆</>}
                </div>
              </div>
              <Heatmap perDay={perDay} today={today} />
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Najbliższe 7 dni</h2>
              <span className="muted">łącznie {Array.from({ length: 7 }, (_, i) => forecast[addDays(today, i)] ?? 0).reduce((a, b) => a + b, 0)}</span>
            </div>
            <Forecast forecast={forecast} today={today} />
          </section>
        </div>

        <section className="panel progress-panel">
          <div className="panel-head">
            <h2>Postęp</h2>
            <span className="muted">{cards.length} {plural(cards.length, "fiszka", "fiszki", "fiszek")}</span>
          </div>
          <div className="progress-n">{progress.mastered} <span className="muted">opanowane</span></div>
          <div className="progress-delta">
            {progress.masteredThisWeek > 0 ? (
              <><span className="up">▲ +{progress.masteredThisWeek}</span> <span className="muted">w tym tygodniu</span></>
            ) : (
              <span className="muted">Fiszka jest opanowana, gdy kolejna powtórka wypada za {MASTERED_DAYS}+ dni.</span>
            )}
          </div>
          <div className="mastery-bar">
            <i className="m-mastered" style={{ flex: progress.mastered }} />
            <i className="m-learning" style={{ flex: progress.learning }} />
            <i className="m-new" style={{ flex: progress.fresh }} />
          </div>
          <div className="mastery-tiles">
            <Tile dot="m-mastered" label="Opanowane" value={progress.mastered} hint={`powtórka za ${MASTERED_DAYS}+ dni`} />
            <Tile dot="m-learning" label="W nauce" value={progress.learning} hint="jeszcze się utrwalają" />
            <Tile dot="m-new" label="Nowe" value={progress.fresh} hint="czekają na pierwszy raz" />
            <Tile
              dot="m-star"
              label="Średnia ocen"
              value={<><span className="avg-star">★</span> {fmtAvg(avgWeek.avg)}</>}
              hint="z ostatnich 7 dni"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function Tile({ dot, label, value, hint }: { dot: string; label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="m-tile">
      <span><i className={`m-dot ${dot}`} />{label}</span>
      <b>{value}</b>
      <small className="muted">{hint}</small>
    </div>
  );
}

function PlanRing({ done, total }: { done: number; total: number }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const frac = total === 0 ? 1 : Math.min(1, done / total);
  const long = String(done).length + String(total).length > 5;
  return (
    <div className="ring" title={`${done} z ${total} fiszek na dziś`}>
      <svg viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} className="ring-track" />
        <circle cx="66" cy="66" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <div className="ring-c">
        <b className={long ? "small" : ""}>
          {done}<span className="ring-total">/{total}</span>
        </b>
        <small className="muted">dzisiejszy plan</small>
      </div>
    </div>
  );
}

function Heatmap({ perDay, today }: { perDay: Record<string, number>; today: string }) {
  const weeks = lastWeeks(today, WEEKS);
  const level = (n: number) => (n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4);
  return (
    <div className="mini-heat">
      <div className="mini-grid">
        {DOW.map((d) => <span key={d} className="mini-dow">{d}</span>)}
        {weeks.flat().map((d) => {
          const n = perDay[d] ?? 0;
          const cls = d > today ? "lx" : `l${level(n)}`;
          return <span key={d} className={`cell ${cls}${d === today ? " today" : ""}`} title={`${d}: ${n} powtórek`} />;
        })}
      </div>
      <div className="heat-legend muted">
        mniej <span className="cell l0" /><span className="cell l1" /><span className="cell l2" /><span className="cell l3" /><span className="cell l4" /> więcej
      </div>
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
