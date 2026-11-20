import { useEffect, useState } from "react";
import { Card, DEFAULT_SETTINGS, isNew, Settings, Store } from "../lib/db";
import { toDay } from "../lib/dates";
import { MAX_RETENTION, MIN_RETENTION } from "../lib/scheduler";

interface Props {
  store: Store;
  version: number;
  onRated: () => void;
  onFree: () => void;
}

interface Counts {
  queue: Card[];
  newAvailable: number;
  newToday: number;
  active: number;
}

export default function LearnMenu({ store, version, onRated, onFree }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [newText, setNewText] = useState("");
  const today = toDay();

  useEffect(() => {
    store.getSettings().then((s) => {
      setSettings(s);
      setNewText(s.newPerDay === null ? "" : String(s.newPerDay));
    });
  }, [store]);

  useEffect(() => {
    (async () => {
      const [queue, active, newToday] = await Promise.all([
        store.dueCards(today),
        store.practiceCards(),
        store.newStudiedToday(today),
      ]);
      setCounts({ queue, active: active.length, newAvailable: active.filter(isNew).length, newToday });
    })();
  }, [store, version, today, settings]);

  const save = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...(s ?? DEFAULT_SETTINGS), ...patch }));
    store.saveSettings(patch);
  };

  if (!settings || !counts) return null;

  const due = counts.queue.length;
  const newInQueue = counts.queue.filter(isNew).length;
  const max = counts.newAvailable;
  const sliderValue = settings.newPerDay === null ? max : Math.min(settings.newPerDay, max);
  const setNew = (n: number | null) => {
    save({ newPerDay: n });
    setNewText(n === null ? "" : String(n));
  };
  const retentionPct = Math.round(settings.retention * 100);

  return (
    <div>
      <h1>Nauka</h1>
      <div className="mode-grid">
        <button className="mode" onClick={onRated} disabled={!due}>
          <span className="mode-icon">★</span>
          <span className="mode-title">Nauka z oceną</span>
          <span className="mode-desc">
            Fiszki zaplanowane na dziś. Oceniasz się od 1 do 5 gwiazdek, a algorytm FSRS wyznacza dzień kolejnej powtórki.
            Liczy się do serii.
          </span>
          <span className="mode-count">
            {due > 0 ? `${due - newInQueue} powtórek · ${newInQueue} nowych` : "Na dziś wszystko zrobione 🎉"}
          </span>
        </button>
        <button className="mode" onClick={onFree} disabled={counts.active === 0}>
          <span className="mode-icon">↻</span>
          <span className="mode-title">Nauka bez oceny</span>
          <span className="mode-desc">
            Swobodne przeglądanie fiszek z wybranych tagów, bez gwiazdek. Nie zmienia terminów powtórek ani statystyk.
          </span>
          <span className="mode-count">{counts.active} aktywnych fiszek</span>
        </button>
      </div>

      <section className="panel learn-settings">
        <h2>Nowe fiszki dzisiaj</h2>
        <div className="new-limit">
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={sliderValue}
            disabled={max === 0}
            aria-label="Ile nowych fiszek dzisiaj"
            onChange={(e) => {
              const v = Number(e.target.value);
              setNew(v >= max ? null : v);
            }}
          />
          <input
            type="number"
            className="new-limit-input"
            min={0}
            step={1}
            placeholder="wszystkie"
            value={newText}
            aria-label="Własna liczba nowych fiszek"
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
          <button className="link" onClick={() => setNew(null)} disabled={settings.newPerDay === null}>wszystkie</button>
        </div>
        <p className="muted small">
          {settings.newPerDay === null ? "Bez limitu" : `Limit: ${settings.newPerDay} dziennie`} · dziś zaczęte {counts.newToday} ·
          {" "}w kolejce {newInQueue} z {max} nowych. Powtórki już poznanych fiszek nie mają limitu.
        </p>
      </section>

      <section className="panel learn-settings">
        <h2>Ustawienia nauki z oceną</h2>
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
