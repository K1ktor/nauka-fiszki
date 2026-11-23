import { useCallback, useEffect, useState } from "react";
import { Card, DEFAULT_SETTINGS, Settings, Store } from "../lib/db";
import { formatInterval, toDay } from "../lib/dates";
import { previewIntervals, STAR_LABELS, Stars } from "../lib/scheduler";
import TypedAnswer from "./TypedAnswer";

interface Props {
  store: Store;
  tags: string[];
  onChange: () => void;
  onDone: () => void;
}

export default function Study({ store, tags, onChange, onDone }: Props) {
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [hover, setHover] = useState<Stars | null>(null);
  const [ratings, setRatings] = useState<Stars[]>([]);
  const [backToLearn, setBackToLearn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [typed, setTyped] = useState("");
  const today = toDay();

  useEffect(() => {
    store.getSettings().then(setSettings);
    store.dueReviews(today, tags).then((c) => setQueue(c));
  }, [store, today, tags]);

  const card = queue?.[index];

  const rate = useCallback(
    async (stars: Stars) => {
      if (!card || !revealed || busy) return;
      setBusy(true);
      const res = await store.rateReview(card, stars, today);
      await store.markStreakDay(today);
      setRatings((r) => [...r, stars]);
      if (res.backToLearn) setBackToLearn((n) => n + 1);
      setRevealed(false);
      setTyped("");
      setHover(null);
      setIndex((i) => i + 1);
      setBusy(false);
      onChange();
    },
    [card, revealed, busy, store, today, onChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === " " || e.key === "Enter") && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4", "5"].includes(e.key)) {
        rate(Number(e.key) as Stars);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate]);

  if (!queue) return null;

  if (queue.length === 0) {
    return (
      <div className="empty">
        <h1>Brak powtórek na dziś 🎉</h1>
        <p className="muted">Wszystko powtórzone{tags.length ? ` w tagach: ${tags.map((t) => "#" + t).join(", ")}` : ""}. Nowe fiszki czekają w Nauce.</p>
        <button className="primary" onClick={onDone}>Wróć</button>
      </div>
    );
  }

  if (!card) {
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    return (
      <div className="empty">
        <h1>Powtórka zakończona! 🔥</h1>
        <p>Powtórzone fiszki: <b>{ratings.length}</b> · średnia ocena: <b>{avg.toFixed(1)} ★</b></p>
        {backToLearn > 0 && (
          <p className="muted">{backToLearn} {backToLearn === 1 ? "fiszka wróciła" : "fiszek wróciło"} do Nauki (ocena 1–2★).</p>
        )}
        <div className="dist">
          {([5, 4, 3, 2, 1] as Stars[]).map((s) => (
            <div key={s}>
              {"★".repeat(s)} <span className="muted">× {ratings.filter((r) => r === s).length}</span>
            </div>
          ))}
        </div>
        <button className="primary" onClick={onDone}>Wróć do panelu</button>
      </div>
    );
  }

  const preview = previewIntervals(card, today, settings.retention);
  const shown = hover ?? 0;

  return (
    <div className="study">
      <div className="progress">
        <div className="progress-bar" style={{ width: `${(index / queue.length) * 100}%` }} />
      </div>
      <div className="study-meta muted">
        <span>Powtórka · {index + 1} / {queue.length}</span>
        <span>{card.tags.map((t) => "#" + t).join(" ")}</span>
        <span>{card.lastReviewed ? `ostatnio: ${card.lastReviewed}` : ""}</span>
      </div>

      <div className="flashcard">
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
          <div className="stars" onMouseLeave={() => setHover(null)}>
            {([1, 2, 3, 4, 5] as Stars[]).map((s) => (
              <button
                key={s}
                className={`star ${s <= shown ? "on" : ""}`}
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
                <b>{STAR_LABELS[hover]}</b> · {hover <= 2 ? <>wraca do <b>Nauki</b></> : <>następna powtórka <b>{formatInterval(preview[hover])}</b></>}
              </>
            ) : (
              <span className="muted">Kliknij gwiazdkę lub naciśnij 1–5</span>
            )}
          </div>
          <div className="rating-legend muted">
            {([1, 2, 3, 4, 5] as Stars[]).map((s) => (
              <span key={s}>{s}★ {s <= 2 ? "do Nauki" : formatInterval(preview[s])}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
