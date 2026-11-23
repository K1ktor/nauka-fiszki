import { useCallback, useEffect, useState } from "react";
import { NO_STAR_FILTER, StarFilter, Store } from "./lib/db";
import { isTauri, sqlJsDriver, tauriDriver } from "./lib/drivers";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import Dashboard from "./components/Dashboard";
import Study from "./components/Study";
import CardList from "./components/CardList";
import ImportView from "./components/ImportView";
import Creator from "./components/Creator";
import LearnMenu from "./components/LearnMenu";
import LearnSetup from "./components/LearnSetup";
import Learn from "./components/Learn";
import PracticeSetup from "./components/PracticeSetup";
import Practice from "./components/Practice";
import Updater from "./components/Updater";
import Onboarding, { GoogleLogo } from "./components/Onboarding";
import { applyTheme, loadTheme, Theme } from "./lib/theme";

const THEMES: { id: Theme; icon: string; label: string }[] = [
  { id: "system", icon: "🖥", label: "Motyw systemowy" },
  { id: "light", icon: "☀️", label: "Jasny motyw" },
  { id: "dark", icon: "🌙", label: "Ciemny motyw" },
];

export type View = "dashboard" | "learn" | "study" | "learn-setup" | "learn-session" | "practice-setup" | "practice" | "cards" | "import";

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dziś" },
  { id: "learn", label: "Nauka" },
  { id: "cards", label: "Fiszki" },
  { id: "import", label: "Dodaj fiszki" },
];

function navOf(v: View): View {
  return v === "study" || v === "learn-setup" || v === "learn-session" || v === "practice-setup" || v === "practice" ? "learn" : v;
}

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [account, setAccount] = useState<"local" | "google">("local");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [addMode, setAddMode] = useState<"creator" | "csv">("csv");
  const [studyTags, setStudyTags] = useState<string[]>([]);
  const [learnTags, setLearnTags] = useState<string[]>([]);
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
  const backToImport = useCallback(() => setAddMode("csv"), []);

  useEffect(() => {
    if (isTauri()) import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const driver = isTauri() ? await tauriDriver() : await sqlJsDriver({ persist: true, wasmUrl });
        const s = new Store(driver);
        await s.init();
        setOnboarding(await s.needsOnboarding());
        setAccount(await s.getAccount());
        setStore(s);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  if (error) return <div className="center error">Nie udało się otworzyć bazy danych: {error}</div>;
  if (!store) return <div className="center muted">Ładowanie…</div>;

  if (onboarding) {
    return (
      <Onboarding
        store={store}
        theme={theme}
        onTheme={changeTheme}
        onDone={(first) => {
          setOnboarding(false);
          bump();
          if (first) {
            setAddMode(first);
            setView("import");
          }
        }}
      />
    );
  }

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
            <button key={n.id} className={navOf(view) === n.id ? "nav active" : "nav"} onClick={() => { setView(n.id); if (n.id === "import") setAddMode("csv"); }}>
              {n.label}
            </button>
          ))}
        </nav>
        {account !== "google" && (
          <div className="login-box">
            <button className="login-btn" disabled title="Logowanie przez Google będzie dostępne wkrótce">
              <GoogleLogo /> Zaloguj się
            </button>
            <span className="small muted">Kopia fiszek w chmurze · wkrótce</span>
          </div>
        )}
        <div className="theme-switch" role="radiogroup" aria-label="Motyw">
          {THEMES.map((t) => (
            <button key={t.id} className={theme === t.id ? "on" : ""} title={t.label} aria-label={t.label} aria-checked={theme === t.id} role="radio" onClick={() => changeTheme(t.id)}>
              {t.icon}
            </button>
          ))}
        </div>
        {!isTauri() && <div className="hint">Tryb przeglądarki: dane w localStorage</div>}
        <button className="link app-version" onClick={() => setOnboarding(true)} title="Otwórz ponownie ekran powitalny (fiszki i ustawienia zostają)">
          Ekran powitalny
        </button>
        {appVersion && <div className="app-version">Wersja {appVersion}</div>}
      </aside>
      <main className="content">
        <Updater />
        {/* Klucz = zakładka: przy każdej zmianie ekranu nowa zawartość łagodnie się pojawia. */}
        <div key={view} className="view-anim">
        {view === "dashboard" && <Dashboard store={store} version={version} onStart={startStudy} onLearn={() => setView("learn-setup")} onImport={() => { setAddMode("csv"); setView("import"); }} onCreate={() => { setAddMode("creator"); setView("import"); }} />}
        {view === "study" && (
          <Study store={store} tags={studyTags} onChange={bump} onDone={() => setView("dashboard")} />
        )}
        {view === "learn" && (
          <LearnMenu store={store} version={version} onReview={() => startStudy([])} onLearn={() => setView("learn-setup")} onFree={() => setView("practice-setup")} />
        )}
        {view === "learn-setup" && (
          <LearnSetup store={store} onBack={() => setView("learn")} onStart={(tags) => { setLearnTags(tags); setView("learn-session"); }} />
        )}
        {view === "learn-session" && (
          <Learn store={store} tags={learnTags} onChange={bump} onDone={() => setView("dashboard")} onBack={() => setView("learn-setup")} />
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
        {view === "import" && (
          <div>
            <div className="panel-head add-head">
              {addMode === "creator" ? (
                <>
                  <h1>Dodaj ręcznie</h1>
                  <button onClick={() => setAddMode("csv")} title="Wróć do importu CSV (Esc)">
                    ← Powrót <kbd className="plain">Esc</kbd>
                  </button>
                </>
              ) : (
                <>
                  <h1>Dodaj fiszki</h1>
                  <button className="primary" onClick={() => setAddMode("creator")}>✍️ Dodaj ręcznie</button>
                </>
              )}
            </div>
            {/* Kreator zostaje zamontowany, żeby lista „Dodane teraz” nie znikała po powrocie do importu. */}
            <div hidden={addMode !== "creator"}>
              <Creator store={store} onChange={bump} onDone={() => setView("cards")} onBack={backToImport} active={addMode === "creator"} />
            </div>
            {addMode === "csv" && <ImportView store={store} onImported={() => { bump(); setView("cards"); }} />}
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
