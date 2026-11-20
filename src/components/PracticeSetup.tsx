import { useEffect, useMemo, useState } from "react";
import { Card, Store } from "../lib/db";

interface Props {
  store: Store;
  onStart: (tags: string[], shuffle: boolean) => void;
  onBack: () => void;
}

export default function PracticeSetup({ store, onStart, onBack }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [shuffle, setShuffle] = useState(true);

  useEffect(() => {
    store.practiceCards().then(setCards);
  }, [store]);

  // Liczba aktywnych (nieuśpionych) fiszek w każdym tagu.
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) for (const t of c.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pl"));
  }, [cards]);

  const all = chosen.length === 0;
  const count = all ? cards.length : cards.filter((c) => c.tags.some((t) => chosen.includes(t))).length;

  const toggleTag = (t: string) =>
    setChosen((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  return (
    <div className="practice-setup">
      <div className="panel-head">
        <h1>Nauka bez oceny</h1>
        <button className="link" onClick={onBack}>← wróć</button>
      </div>
      <section className="panel">
        <h2>Wybierz tagi</h2>
        <label className="check all-check">
          <input type="checkbox" checked={all} onChange={() => setChosen([])} />
          Wszystko <span className="muted">({cards.length})</span>
        </label>
        <div className="tag-checks">
          {tagCounts.map(([t, n]) => (
            <label key={t} className={`check tag-check ${chosen.includes(t) ? "on" : ""}`}>
              <input type="checkbox" checked={chosen.includes(t)} onChange={() => toggleTag(t)} />
              #{t} <span className="muted">({n})</span>
            </label>
          ))}
          {tagCounts.length === 0 && <p className="muted">Twoje fiszki nie mają jeszcze tagów.</p>}
        </div>
      </section>
      <div className="start-row">
        <button className="primary big" disabled={count === 0} onClick={() => onStart(chosen, shuffle)}>
          Rozpocznij ({count})
        </button>
        <label className="check normal">
          <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
          losowa kolejność
        </label>
      </div>
    </div>
  );
}
