import { useEffect, useState } from "react";
import { Card, DEFAULT_SETTINGS, learnCards, reviewQueue, Settings, Store } from "../lib/db";
import { toDay } from "../lib/dates";
import { MAX_RETENTION, MIN_RETENTION } from "../lib/scheduler";
import { clampPoolSize, MAX_POOL_SIZE, MIN_POOL_SIZE, streakNewTarget } from "../lib/learn";

interface Props {
  store: Store;
  version: number;
  onLearn: () => void;
  onReview: () => void;
  onFree: () => void;
}

interface Counts {
  reviews: number;
  learn: Card[];
  active: number;
  learnedToday: number;
}

/** Suwak limitu: maksymalna pozycja = „bez limitu”. */
const LIMIT_MAX = 100;

export default function LearnMenu({ store, version, onLearn, onReview, onFree }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [newText, setNewText] = useState("");
  const [poolText, setPoolText] = useState("");
  const today = toDay();

  useEffect(() => {
    store.getSettings().then((s) => {
      setSettings(s);
      setNewText(s.newPerDay === null ? "" : String(s.newPerDay));
      setPoolText(String(s.poolSize));
    });
  }, [store]);

  useEffect(() => {
    (async () => {
      const [cards, learnedToday] = await Promise.all([store.listCards(), store.learnedToday(today)]);
      setCounts({
        reviews: reviewQueue(cards, today).length,
        learn: learnCards(cards),
        active: cards.filter((c) => !c.suspended).length,
        learnedToday,
      });
    })();
  }, [store, version, today]);

  const save = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...(s ?? DEFAULT_SETTINGS), ...patch }));
    store.saveSettings(patch);
  };

  if (!settings || !counts) return null;

  const sliderValue = settings.newPerDay === null ? LIMIT_MAX : Math.min(settings.newPerDay, LIMIT_MAX);
  const setNew = (n: number | null) => {
    save({ newPerDay: n });
    setNewText(n === null ? "" : String(n));
  };
  const retentionPct = Math.round(settings.retention * 100);
  const inPool = counts.learn.filter((c) => c.inPool).length;

  return (
    <div>
      <h1>Nauka</h1>
      <div className="mode-grid three">
        <button className="mode" onClick={onReview} disabled={counts.reviews === 0}>
          <span className="mode-icon">↺</span>
          <span className="mode-title">Powtórka</span>
          <span className="mode-desc">
            Fiszki, które już umiesz, z terminem na dziś wg FSRS. Ocena 1–2★ odsyła fiszkę z powrotem do Nauki.
          </span>
          <span className="mode-count">{counts.reviews > 0 ? `${counts.reviews} do zrobienia` : "Na dziś wszystko powtórzone 🎉"}</span>
        </button>
        <button className="mode" onClick={onLearn} disabled={counts.learn.length === 0}>
          <span className="mode-icon">★</span>
          <span className="mode-title">Nauka</span>
          <span className="mode-desc">
            Nowe fiszki z wybranych tagów, {settings.poolSize} naraz. Trzy oceny ≥4★ z rzędu (albo „To już umiem”) i fiszka przechodzi do Powtórki.
          </span>
          <span className="mode-count">
            {counts.learn.length > 0 ? `${counts.learn.length} w Nauce${inPool ? ` · w puli ${inPool}` : ""}` : "Brak nowych fiszek"}
          </span>
        </button>
        <button className="mode" onClick={onFree} disabled={counts.active === 0}>
          <span className="mode-icon">↻</span>
          <span className="mode-title">Tryb swobodny</span>
          <span className="mode-desc">
            Przeglądanie wszystkich fiszek albo wybranych tagów, bez ocen. Nie zmienia terminów ani statystyk.
          </span>
          <span className="mode-count">{counts.active} aktywnych fiszek</span>
        </button>
      </div>

      <section className="panel learn-settings">
        <h2>Nowe fiszki dziennie</h2>
        <div className="new-limit">
          <input
            type="range"
            min={0}
            max={LIMIT_MAX}
            step={1}
            value={sliderValue}
            aria-label="Dzienny limit nowych fiszek"
            onChange={(e) => {
              const v = Number(e.target.value);
              setNew(v >= LIMIT_MAX ? null : v);
            }}
          />
          <input
            type="number"
            className="new-limit-input"
            min={0}
            step={1}
            placeholder="bez limitu"
            value={newText}
            aria-label="Własny dzienny limit nowych fiszek"
            onChange={(e) => {
              const raw = e.target.value;
              setNewText(raw);
              if (raw.trim() === "") save({ newPerDay: null });
              else {
                const n = Math.floor(Number(raw));
                if (Number.isFinite(n) && n >= 0) save({ newPerDay: n });
              }
            }}
          />
          <button className="link" onClick={() => setNew(null)} disabled={settings.newPerDay === null}>bez limitu</button>
        </div>
        <p className="muted small">
          {settings.newPerDay === null ? "Bez limitu" : `Limit: ${settings.newPerDay} dziennie`} · nauczone dziś {counts.learnedToday}.
          {" "}Po limicie zapytamy, czy nie pora odpocząć (możesz uczyć się dalej). Seria dnia: wszystkie powtórki albo {streakNewTarget(settings.newPerDay)} nowych.
        </p>

        <div className="retention pool-size">
          <span>Fiszek naraz w puli</span>
          <input
            type="number"
            className="new-limit-input"
            min={MIN_POOL_SIZE}
            max={MAX_POOL_SIZE}
            value={poolText}
            aria-label="Wielkość puli Nauki"
            onChange={(e) => setPoolText(e.target.value)}
            onBlur={() => {
              const n = clampPoolSize(Number(poolText));
              setPoolText(String(n));
              save({ poolSize: n });
            }}
          />
        </div>
        <p className="muted small">Ile fiszek ćwiczysz jednocześnie w Nauce ({MIN_POOL_SIZE}–{MAX_POOL_SIZE}, domyślnie 20).</p>
      </section>

      <section className="panel learn-settings">
        <h2>Ustawienia</h2>
        <label className="check normal">
          <input type="checkbox" checked={settings.typeAnswer} onChange={(e) => save({ typeAnswer: e.target.checked })} />
          Wpisuj odpowiedź przed odsłonięciem
        </label>
        <p className="muted small">Po odsłonięciu zobaczysz swoją odpowiedź obok poprawnej. Ocenę gwiazdkami nadal wybierasz sam.</p>

        <div className="retention">
          <span>Docelowa skuteczność</span>
          <input
            type="range"
            min={Math.round(MIN_RETENTION * 100)}
            max={Math.round(MAX_RETENTION * 100)}
            step={1}
            value={retentionPct}
            aria-label="Docelowa skuteczność"
            onChange={(e) => save({ retention: Number(e.target.value) / 100 })}
          />
          <b>{retentionPct}%</b>
          {/* Przycisk zawsze zajmuje miejsce (tylko ukryty), żeby suwak nie zmieniał szerokości przy 90%. */}
          <button
            className="link"
            style={{ visibility: retentionPct === 90 ? "hidden" : "visible" }}
            aria-hidden={retentionPct === 90}
            tabIndex={retentionPct === 90 ? -1 : 0}
            onClick={() => save({ retention: 0.9 })}
          >
            przywróć 90%
          </button>
        </div>
        <p className="muted small">
          FSRS planuje powtórkę na moment, gdy szansa, że jeszcze pamiętasz fiszkę, spadnie do {retentionPct}%.
          Wyżej = krótsze odstępy i więcej powtórek, niżej = mniej pracy, ale częściej zapomnisz. Zmiana działa od następnej oceny.
        </p>
      </section>
    </div>
  );
}
