import { useCallback, useEffect, useState } from "react";
import { NO_STAR_FILTER, StarFilter, Store } from "./lib/db";
import { isTauri, sqlJsDriver, tauriDriver } from "./lib/drivers";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import Dashboard from "./components/Dashboard";
import Study from "./components/Study";
import CardList from "./components/CardList";
import ImportView from "./components/ImportView";
import LearnMenu from "./components/LearnMenu";
import PracticeSetup from "./components/PracticeSetup";
import Practice from "./components/Practice";
import Updater from "./components/Updater";
import { applyTheme, loadTheme, Theme } from "./lib/theme";

const THEMES: { id: Theme; icon: string; label: string }[] = [
  { id: "system", icon: "🖥", label: "Motyw systemowy" },
  { id: "light", icon: "☀️", label: "Jasny motyw" },
  { id: "dark", icon: "🌙", label: "Ciemny motyw" },
];

export type View = "dashboard" | "learn" | "study" | "practice-setup" | "practice" | "cards" | "import";

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dziś" },
  { id: "learn", label: "Nauka" },
  { id: "cards", label: "Fiszki" },
  { id: "import", label: "Import CSV" },
];

function navOf(v: View): View {
  return v === "study" || v === "practice-setup" || v === "practice" ? "learn" : v;
}

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [studyTags, setStudyTags] = useState<string[]>([]);
  const [practice, setPractice] = useState<{ tags: string[]; shuffle: boolean; stars: StarFilter }>({ tags: [], shuffle: true, stars: NO_STAR_FILTER });
  // Licznik zmian – odświeża widoki po imporcie/ocenie.
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const changeTheme = (t: Theme) => {
    applyTheme(t);
    setTheme(t);
  };
  const [version, setVersion] = useState(0);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (isTauri()) import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const driver = isTauri() ? await tauriDriver() : await sqlJsDriver({ persist: true, wasmUrl });
        const s = new Store(driver);
        await s.init();
        setStore(s);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  if (error) return <div className="center error">Nie udało się otworzyć bazy danych: {error}</div>;
  if (!store) return <div className="center muted">Ładowanie…</div>;

  const startStudy = (tags: string[]) => {
    setStudyTags(tags);
    setView("study");
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-mark">◆</span> Fiszki
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={navOf(view) === n.id ? "nav active" : "nav"} onClick={() => setView(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="theme-switch" role="radiogroup" aria-label="Motyw">
          {THEMES.map((t) => (
            <button key={t.id} className={theme === t.id ? "on" : ""} title={t.label} aria-label={t.label} aria-checked={theme === t.id} role="radio" onClick={() => changeTheme(t.id)}>
              {t.icon}
            </button>
          ))}
        </div>
        {!isTauri() && <div className="hint">Tryb przeglądarki: dane w localStorage</div>}
        {appVersion && <div className="app-version">Wersja {appVersion}</div>}
      </aside>
      <main className="content">
        <Updater />
        {view === "dashboard" && <Dashboard store={store} version={version} onStart={startStudy} onImport={() => setView("import")} />}
        {view === "study" && (
          <Study store={store} tags={studyTags} onChange={bump} onDone={() => setView("dashboard")} />
        )}
        {view === "learn" && (
          <LearnMenu store={store} version={version} onRated={() => startStudy([])} onFree={() => setView("practice-setup")} />
        )}
        {view === "practice-setup" && (
          <PracticeSetup
            store={store}
            onBack={() => setView("learn")}
            onStart={(tags, shuffle, stars) => {
              setPractice({ tags, shuffle, stars });
              setView("practice");
            }}
          />
        )}
        {view === "practice" && (
          <Practice store={store} tags={practice.tags} shuffle={practice.shuffle} stars={practice.stars} onBack={() => setView("practice-setup")} />
        )}
        {view === "cards" && <CardList store={store} version={version} onChange={bump} />}
        {view === "import" && <ImportView store={store} onImported={() => { bump(); setView("cards"); }} />}
      </main>
    </div>
  );
}
