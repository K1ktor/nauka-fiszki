import { useState } from "react";
import { DEFAULT_SETTINGS, Store } from "../lib/db";
import { MAX_RETENTION, MIN_RETENTION } from "../lib/scheduler";
import { Theme } from "../lib/theme";

export type FirstStep = "creator" | "csv" | null;

interface Props {
  store: Store;
  /** Koniec powitania; `first` – co użytkownik wybrał na drugim slajdzie (null = pominął). */
  onDone: (first: FirstStep) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
}

const THEME_OPTIONS: { id: Theme; label: string; desc: string }[] = [
  { id: "dark", label: "Ciemny", desc: "Ciemne tło, łagodne dla oczu wieczorem." },
  { id: "light", label: "Jasny", desc: "Jasne tło, dobre za dnia." },
  { id: "system", label: "Systemowy", desc: "Jak w ustawieniach Windowsa." },
];

/** Miniatura okna aplikacji w danym motywie. */
function ThemePreview({ id }: { id: Theme }) {
  if (id === "system") {
    // Pół na pół: jasny i ciemny, przecięte po skosie.
    return (
      <span className="theme-preview system" aria-hidden="true">
        <ThemePreview id="light" />
        <ThemePreview id="dark" />
      </span>
    );
  }
  return (
    <span className={`theme-preview ${id}`} aria-hidden="true">
      <span className="tp-side" />
      <span className="tp-main">
        <span className="tp-line w60" />
        <span className="tp-card"><span className="tp-line w80" /><span className="tp-line w50" /></span>
      </span>
    </span>
  );
}

const NEW_MAX = 100; // pozycja suwaka „bez limitu”
const NEW_DEFAULT = 20;

export function GoogleLogo() {
  return (
    <svg className="ai-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.8z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.28a12 12 0 0 0 0 10.78l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.28 6.61l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77z" />
    </svg>
  );
}

export default function Onboarding({ store, onDone, theme, onTheme }: Props) {
  const [step, setStep] = useState(0);
  // Kierunek animacji: dalej = wjazd z prawej, wstecz = z lewej.
  const [dir, setDir] = useState<"next" | "back">("next");
  const go = (n: number) => {
    setDir(n >= step ? "next" : "back");
    setStep(n);
  };
  const [first, setFirst] = useState<FirstStep>(null);
  const [newPerDay, setNewPerDay] = useState(NEW_DEFAULT);
  const [retention, setRetention] = useState(Math.round(DEFAULT_SETTINGS.retention * 100));

  const finish = async (saveSettings: boolean, choice: FirstStep = first) => {
    if (saveSettings) {
      await store.saveSettings({ newPerDay: newPerDay >= NEW_MAX ? null : newPerDay, retention: retention / 100 });
    }
    await store.finishOnboarding("local");
    onDone(choice);
  };

  const pick = (c: FirstStep) => {
    setFirst(c);
    go(3);
  };

  return (
    <div className="onboarding">
      <div className="onb-card">
        <div className="onb-dots" aria-label={`Krok ${step + 1} z 4`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i === step ? "on" : i < step ? "done" : ""} />
          ))}
        </div>

        {/* key = krok: przy każdej zmianie slajd montuje się od nowa i odgrywa animację wejścia. */}
        <div className="onb-stage" key={step} data-dir={dir}>
        {step === 0 && (
          <div className="onb-step">
            <div className="onb-mark">◆</div>
            <h1>Witaj w Fiszkach</h1>
            <p className="muted">Ucz się z fiszek, oceniaj się gwiazdkami, a algorytm powtórek zaplanuje resztę.</p>
            <div className="onb-options">
              <button className="onb-option recommended" disabled title="Logowanie przez Google będzie dostępne wkrótce">
                <span className="onb-badge onb-option-badge">Zalecane</span>
                <span className="onb-option-icon"><GoogleLogo /></span>
                <b>Zaloguj przez Google</b>
                <span className="muted small">Fiszki w chmurze, dostępne na każdym urządzeniu.</span>
                <span className="onb-soon">wkrótce</span>
              </button>
              <button className="onb-option" onClick={() => go(1)}>
                <span className="onb-option-icon">💻</span>
                <b>Kontynuuj lokalnie</b>
                <span className="muted small">Bez konta. Fiszki zostają tylko na tym komputerze.</span>
              </button>
            </div>
            <p className="muted small onb-note">
              Logowanie zapisuje fiszki w chmurze, więc nie przepadną i będą dostępne na innych urządzeniach. Jeśli Ci na tym
              nie zależy, kontynuuj lokalnie – fiszki zostaną tylko na tym komputerze.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="onb-step">
            <h1>Wybierz motyw</h1>
            <p className="muted">Zmienisz go później przełącznikiem na dole paska bocznego.</p>
            <div className="onb-options three" role="radiogroup" aria-label="Motyw">
              {THEME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={theme === t.id}
                  className={theme === t.id ? "onb-option selected" : "onb-option"}
                  onClick={() => onTheme(t.id)}
                >
                  <ThemePreview id={t.id} />
                  <b>{t.label}</b>
                  <span className="muted small">{t.desc}</span>
                </button>
              ))}
            </div>
            <div className="onb-nav">
              <button className="link" onClick={() => go(0)}>← Wstecz</button>
              <div className="onb-nav-right">
                <button onClick={() => go(2)}>Pomiń</button>
                <button className="primary" onClick={() => go(2)}>Dalej →</button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onb-step">
            <h1>Dodaj pierwsze fiszki</h1>
            <p className="muted">Wybierz, jak chcesz zacząć. Później znajdziesz obie opcje w zakładce „Dodaj fiszki”.</p>
            <div className="onb-options">
              <button className="onb-option recommended" onClick={() => pick("csv")}>
                <span className="onb-badge onb-option-badge">Zalecane</span>
                <span className="onb-option-icon">📄</span>
                <b>Zaimportuj z CSV</b>
                <span className="muted small">Masz już plik albo chcesz go wygenerować z notatek przez ChatGPT lub Claude.</span>
              </button>
              <button className="onb-option" onClick={() => pick("creator")}>
                <span className="onb-option-icon">✍️</span>
                <b>Dodaj w kreatorze</b>
                <span className="muted small">Wpisujesz pytanie i odpowiedź, jedna fiszka po drugiej.</span>
              </button>
            </div>
            <div className="onb-nav">
              <button className="link" onClick={() => go(1)}>← Wstecz</button>
              <button onClick={() => pick(null)}>Pomiń</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onb-step">
            <h1>Ustaw tempo nauki</h1>
            <p className="muted">Możesz to zmienić w każdej chwili w zakładce „Nauka”.</p>

            <div className="onb-slider">
              <div className="onb-slider-head">
                <span>Nowe fiszki dziennie</span>
                <b>{newPerDay >= NEW_MAX ? "bez limitu" : newPerDay}</b>
              </div>
              <input
                type="range"
                min={5}
                max={NEW_MAX}
                step={5}
                value={newPerDay}
                aria-label="Nowe fiszki dziennie"
                onChange={(e) => setNewPerDay(Number(e.target.value))}
              />
              <p className="muted small">Dzienny limit nowych fiszek w Nauce. Po nim zapytamy, czy nie pora odpocząć. Powtórki nie mają limitu.</p>
            </div>

            <div className="onb-slider">
              <div className="onb-slider-head">
                <span>Docelowa skuteczność</span>
                <b>{retention}%</b>
              </div>
              <input
                type="range"
                min={Math.round(MIN_RETENTION * 100)}
                max={Math.round(MAX_RETENTION * 100)}
                step={1}
                value={retention}
                aria-label="Docelowa skuteczność"
                onChange={(e) => setRetention(Number(e.target.value))}
              />
              <p className="muted small">Wyżej = częstsze powtórki i lepsza pamięć, niżej = mniej pracy. 90% to dobry początek.</p>
            </div>

            <div className="onb-nav">
              <button className="link" onClick={() => go(2)}>← Wstecz</button>
              <div className="onb-nav-right">
                <button onClick={() => finish(false)}>Pomiń</button>
                <button className="primary" onClick={() => finish(true)}>Zaczynamy →</button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
