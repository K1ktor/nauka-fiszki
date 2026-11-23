import { useEffect, useMemo, useState } from "react";
import { Card, learnCards, Store } from "../lib/db";

interface Props {
  store: Store;
  onStart: (tags: string[]) => void;
  onBack: () => void;
}

/** Nauka: wybór tagów przed sesją (domyślnie wszystkie). */
export default function LearnSetup({ store, onStart, onBack }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [poolSize, setPoolSize] = useState(20);
  const [chosen, setChosen] = useState<string[]>([]);

  useEffect(() => {
    store.listCards().then((all) => setCards(learnCards(all)));
    store.getSettings().then((s) => setPoolSize(s.poolSize));
  }, [store]);

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) for (const t of c.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pl"));
  }, [cards]);

  const all = chosen.length === 0;
  const picked = all ? cards : cards.filter((c) => c.tags.some((t) => chosen.includes(t)));
  const inPool = picked.filter((c) => c.inPool).length;
  const count = Math.max(inPool, Math.min(poolSize, picked.length));
  const toggleTag = (t: string) => setChosen((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  return (
    <div className="practice-setup">
      <div className="panel-head">
        <h1>Nauka</h1>
        <button className="link" onClick={onBack}>← wróć</button>
      </div>
      <section className="panel">
        <h2>Czego chcesz się uczyć?</h2>
        <label className="check all-check">
          <input type="checkbox" checked={all} onChange={() => setChosen([])} />
          Wszystkie <span className="muted">({cards.length})</span>
        </label>
        <div className="tag-checks">
          {tagCounts.map(([t, n]) => (
            <label key={t} className={`check tag-check ${chosen.includes(t) ? "on" : ""}`}>
              <input type="checkbox" checked={chosen.includes(t)} onChange={() => toggleTag(t)} />
              #{t} <span className="muted">({n})</span>
            </label>
          ))}
          {tagCounts.length === 0 && cards.length > 0 && <p className="muted">Twoje fiszki nie mają jeszcze tagów.</p>}
        </div>
        <p className="muted small">
          Uczysz się naraz {count} {count === 1 ? "fiszki" : "fiszek"} (pula zapisuje się między sesjami
          {inPool > 0 ? `, teraz w puli ${inPool}` : ""}). Gdy fiszka zbierze 3 oceny ≥4★ z rzędu, przechodzi do Powtórki,
          a na jej miejsce wchodzi kolejna, losowa.
        </p>
      </section>
      <div className="start-row">
        <button className="primary big" disabled={picked.length === 0} onClick={() => onStart(chosen)}>
          Zaczynamy ({count})
        </button>
      </div>
    </div>
  );
}
