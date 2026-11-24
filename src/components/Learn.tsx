import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, DEFAULT_SETTINGS, Settings, Store } from "../lib/db";
import { toDay } from "../lib/dates";
import { breakAt, graduationInterval, insertRandom, LEARN_TARGET, learnStep, requeue, shuffle } from "../lib/learn";
import { STAR_LABELS, Stars } from "../lib/scheduler";
import TypedAnswer from "./TypedAnswer";
import Burst from "./Burst";
import { settle } from "../lib/juice";

interface Props {
  store: Store;
  tags: string[];
  onChange: () => void;
  onDone: () => void;
  onBack: () => void;
}

/** Ile ms fiszka zostaje na ekranie po ocenie, żeby było widać wypełnione kółko. */
const SETTLE_MS = 450;
/** Dłużej, gdy fiszka przechodzi do Powtórki – żeby wybrzmiała animacja. */
const GRADUATE_MS = 750;

type Fx = "gain" | "lose" | "grad" | null;

/** Polska odmiana: 1 fiszka, 2–4 fiszki, 5+ fiszek. */
function fiszek(n: number): string {
  if (n === 1) return "fiszkę";
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? "fiszki" : "fiszek";
}

function hint(card: Card, stars: Stars): string {
  const step = learnStep(card.learnStreak, stars);
  if (step.graduated) {
    const iv = graduationInterval(stars);
    return `przechodzi do Powtórki · pierwsza powtórka ${iv === 1 ? "jutro" : `za ${iv} dni`}`;
  }
  if (stars <= 2) return card.learnStreak > 0 ? "kółka od nowa · wraca za chwilę" : "wraca za chwilę";
  if (stars === 3) return "kółka bez zmian · wraca trochę później";
  return "+1 kółko · wraca najpóźniej";
}

/** Tryb Nauka: aktywna pula fiszek, każda potrzebuje 3 ocen ≥4★ z rzędu, żeby przejść do Powtórki. */
export default function Learn({ store, tags, onChange, onDone, onBack }: Props) {
  const today = toDay();
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const [hover, setHover] = useState<Stars | null>(null);
  const [busy, setBusy] = useState(false);
  const [learned, setLearned] = useState(0);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [showBreak, setShowBreak] = useState(false);
  const [sessionLearned, setSessionLearned] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  // Animacje: efekt na fiszce po ocenie, kliknięta gwiazdka, licznik wejść fiszek i nauczonych (konfetti).
  const [fx, setFx] = useState<Fx>(null);
  const [picked, setPicked] = useState(0);
  const [turn, setTurn] = useState(0);
  const [grads, setGrads] = useState(0);

  useEffect(() => {
    (async () => {
      const [s, pool, n] = await Promise.all([store.getSettings(), store.learnPool(tags), store.learnedToday(today)]);
      setSettings(s);
      setQueue(shuffle(pool));
      setLearned(n);
      const t = breakAt(s.newPerDay);
      setThreshold(t);
      if (t !== null && n >= t && pool.length > 0) setShowBreak(true);
    })();
  }, [store, tags, today]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const card = queue?.[0];

  const flash = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };

  const rate = useCallback(
    async (stars: Stars, knowIt = false) => {
      if (!card || !queue || busy || showBreak) return;
      if (!knowIt && !revealed) return;
      setBusy(true);
      setPicked(knowIt ? 0 : stars);
      const res = await store.rateLearn(card, stars, today, knowIt);
      const effect: Fx = res.graduated ? "grad" : res.streak > card.learnStreak ? "gain" : res.streak < card.learnStreak ? "lose" : null;
      setFx(effect);
      if (res.graduated) setGrads((g) => g + 1);
      // Pokaż wypełnione kółka na tej samej fiszce, zanim przejdziemy dalej.
      setQueue((q) => (q ? [{ ...q[0], learnStreak: res.streak }, ...q.slice(1)] : q));
      setRevealed(true);
      await settle(res.graduated ? GRADUATE_MS : SETTLE_MS);

      let next: Card[];
      if (res.graduated) {
        // Przesuwane okno: na miejsce nauczonej fiszki wchodzi kolejna (w losowe miejsce kolejki).
        next = queue.slice(1);
        const pool = await store.learnPool(tags);
        const known = new Set(queue.map((c) => c.id));
        for (const c of pool) if (!known.has(c.id)) next = insertRandom(next, c);
        const n = learned + 1;
        setLearned(n);
        setSessionLearned((x) => x + 1);
        const iv = graduationInterval(knowIt ? 5 : stars);
        flash(`✓ Nauczona! Pierwsza powtórka ${iv === 1 ? "jutro" : `za ${iv} dni`}.`);
        await store.markStreakDay(today);
        if (threshold !== null && n >= threshold && next.length > 0) setShowBreak(true);
      } else {
        next = requeue([{ ...card, learnStreak: res.streak }, ...queue.slice(1)], stars);
      }
      setQueue(next);
      setRevealed(false);
      setTyped("");
      setHover(null);
      setFx(null);
      setPicked(0);
      setTurn((t) => t + 1);
      setBusy(false);
      onChange();
    },
    [card, queue, busy, showBreak, revealed, store, today, tags, learned, threshold, onChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showBreak) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === " " || e.key === "Enter") && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && !busy && ["1", "2", "3", "4", "5"].includes(e.key)) {
        rate(Number(e.key) as Stars);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, busy, rate, showBreak]);

  if (!queue) return null;

  const tagNote = tags.length ? ` w tagach: ${tags.map((t) => "#" + t).join(", ")}` : "";

  if (!card) {
    return (
      <div className="empty">
        {sessionLearned > 0 ? (
          <>
            <Burst burstKey="done" />
            <h1>Wszystko nauczone! 🎓</h1>
            <p className="muted">W tej sesji do Powtórki przeszło {sessionLearned} {fiszek(sessionLearned)}{tagNote}. Nie ma już nowych fiszek w Nauce.</p>
          </>
        ) : (
          <>
            <h1>Brak fiszek do nauki</h1>
            <p className="muted">Wszystkie fiszki{tagNote} są już w Powtórce. Dodaj nowe albo wybierz inne tagi.</p>
          </>
        )}
        <div className="start-row">
          <button className="primary" onClick={onDone}>Wróć do panelu</button>
          <button onClick={onBack}>Wybierz inne tagi</button>
        </div>
      </div>
    );
  }

  const limit = settings.newPerDay;
  const shown = hover ?? 0;

  return (
    <div className="study">
      <div className="progress">
        <div className="progress-bar learn" style={{ width: `${limit ? Math.min(100, (learned / Math.max(1, limit)) * 100) : 0}%` }} />
      </div>
      <div className="study-meta muted">
        <span>Nauka · w puli {queue.length}</span>
        <span>{card.tags.map((t) => "#" + t).join(" ")}</span>
        <span>nauczone dziś {learned}{limit !== null ? ` / ${limit}` : ""}</span>
      </div>

      <div key={turn} className={`flashcard learn-card${revealed ? " revealed" : ""}${fx ? ` fx-${fx}` : ""}`}>
        <div className={fx === "lose" ? "circles shake" : "circles"} title={`${card.learnStreak} z ${LEARN_TARGET} – trzy oceny ≥4★ z rzędu przenoszą fiszkę do Powtórki`} aria-label={`Seria ${card.learnStreak} z ${LEARN_TARGET}`}>
          {Array.from({ length: LEARN_TARGET }, (_, i) => (
            <span
              key={i}
              className={`circle${i < card.learnStreak ? " on" : ""}${(fx === "gain" && i === card.learnStreak - 1) || fx === "grad" ? " pop" : ""}`}
              style={{ "--i": i } as React.CSSProperties}
            />
          ))}
        </div>
        <div className="side-label">Pytanie</div>
        <div className="q">{card.question}</div>
        {settings.typeAnswer && !revealed && (
          <input
            key={card.id}
            className="type-answer"
            autoFocus
            placeholder="Wpisz odpowiedź i naciśnij Enter"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setRevealed(true);
              }
            }}
          />
        )}
        {revealed && (
          <>
            <hr />
            {settings.typeAnswer && <TypedAnswer typed={typed} answer={card.answer} />}
            <div className="side-label">Odpowiedź</div>
            <div className="a">{card.answer}</div>
          </>
        )}
      </div>

      {!revealed ? (
        <button className="primary big reveal" onClick={() => setRevealed(true)}>
          Pokaż odpowiedź <kbd>{settings.typeAnswer ? "Enter" : "Spacja"}</kbd>
        </button>
      ) : (
        <div className="rating">
          <div className="rating-q">Jak dobrze znasz odpowiedź?</div>
          <div className={picked ? "stars picked" : "stars"} onMouseLeave={() => setHover(null)}>
            {([1, 2, 3, 4, 5] as Stars[]).map((s) => (
              <button
                key={s}
                className={`star ${s <= (picked || shown) ? "on" : ""}${s <= picked ? " hit" : ""}`}
                style={{ "--i": s } as React.CSSProperties}
                onMouseEnter={() => setHover(s)}
                onFocus={() => setHover(s)}
                onClick={() => rate(s)}
                disabled={busy}
                aria-label={`${s} gwiazdek: ${STAR_LABELS[s]}`}
              >
                ★
              </button>
            ))}
          </div>
          <div className="rating-hint">
            {hover ? (
              <>
                <b>{STAR_LABELS[hover]}</b> · {hint(card, hover)}
              </>
            ) : (
              <span className="muted">Kliknij gwiazdkę lub naciśnij 1–5 · 4–5★ wypełnia kółko</span>
            )}
          </div>
        </div>
      )}
      <div className="know-row">
        <button className="link" onClick={() => rate(5, true)} disabled={busy}>
          ✓ To już umiem
        </button>
        <span className="muted small">od razu do Powtórki (pierwsza za 3 dni)</span>
      </div>

      {/* Portal: rodzic ekranu ma animację (transform), która psułaby position: fixed. */}
      {grads > 0 && <Burst burstKey={grads} size="small" y={30} count={18} />}
      {toast && createPortal(<div className="toast">{toast}</div>, document.body)}

      {showBreak && createPortal(
        <div className="modal-bg">
          <div className="modal break-modal" role="dialog" aria-modal="true">
            <div className="break-emoji">🧠☕</div>
            <h2>Hej mądralo, nauczyłeś się już dziś {learned} {fiszek(learned)}, może pora odpocząć?</h2>
            <p className="muted small">
              Każda nowa fiszka to kolejne powtórki w najbliższych dniach. Im więcej dziś, tym dłuższa Powtórka jutro i pojutrze.
            </p>
            <div className="modal-actions">
              <button onClick={onDone}>Koniec na dziś</button>
              <button
                className="primary"
                autoFocus
                onClick={() => {
                  setThreshold(breakAt(limit, learned));
                  setShowBreak(false);
                }}
              >
                Lecimy dalej 🚀
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
