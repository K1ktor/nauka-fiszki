import { useEffect, useState } from "react";
import { Card, StarFilter, Store } from "../lib/db";

interface Props {
  store: Store;
  tags: string[];
  shuffle: boolean;
  stars: StarFilter;
  onBack: () => void;
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Nauka bez oceny: przeglądanie fiszek bez wpływu na terminy powtórek i statystyki. */
export default function Practice({ store, tags, shuffle, stars, onBack }: Props) {
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    store.practiceCards(tags, stars).then((c) => {
      setQueue(shuffle ? shuffled(c) : c);
      setIndex(0);
      setRevealed(false);
    });
  }, [store, tags, shuffle, stars, round]);

  const card = queue?.[index];
  const next = () => {
    setRevealed(false);
    setIndex((i) => i + 1);
  };
  const prev = () => {
    setRevealed(false);
    setIndex((i) => Math.max(0, i - 1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        else next();
      } else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed]);

  if (!queue) return null;

  if (!card) {
    return (
      <div className="empty">
        <h1>Przejrzano wszystkie fiszki 👏</h1>
        <p className="muted">
          {queue.length} fiszek{tags.length ? ` z tagów ${tags.map((t) => "#" + t).join(", ")}` : ""}
          {stars.below !== null ? ` ze średnią poniżej ${stars.below.toLocaleString("pl-PL")}★` : ""}. Bez wpływu na terminy powtórek.
        </p>
        <div className="start-row">
          <button className="primary" onClick={() => setRound((r) => r + 1)}>Jeszcze raz</button>
          <button onClick={onBack}>Wybierz inne tagi</button>
        </div>
      </div>
    );
  }

  return (
    <div className="study">
      <div className="progress">
        <div className="progress-bar free" style={{ width: `${(index / queue.length) * 100}%` }} />
      </div>
      <div className="study-meta muted">
        <span>{index + 1} / {queue.length} · bez oceny</span>
        <span>
          {card.avgStars !== null ? `śr. ${card.avgStars.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}★ · ` : ""}
          {card.tags.map((t) => "#" + t).join(" ")}
        </span>
        <button className="link" onClick={onBack}>zakończ</button>
      </div>

      <div className="flashcard">
        <div className="side-label">Pytanie</div>
        <div className="q">{card.question}</div>
        {revealed && (
          <>
            <hr />
            <div className="side-label">Odpowiedź</div>
            <div className="a">{card.answer}</div>
          </>
        )}
      </div>

      <div className="practice-nav">
        <button onClick={prev} disabled={index === 0}>← Poprzednia</button>
        {!revealed ? (
          <button className="primary big" onClick={() => setRevealed(true)}>
            Pokaż odpowiedź <kbd>Spacja</kbd>
          </button>
        ) : (
          <button className="primary big" onClick={next}>
            Następna <kbd>Spacja</kbd>
          </button>
        )}
        <button onClick={next}>Pomiń →</button>
      </div>
    </div>
  );
}
