import { useEffect, useState } from "react";
import { Store } from "../lib/db";
import { toDay } from "../lib/dates";

interface Props {
  store: Store;
  version: number;
  onRated: () => void;
  onFree: () => void;
}

export default function LearnMenu({ store, version, onRated, onFree }: Props) {
  const [due, setDue] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    store.dueCards(toDay()).then((c) => setDue(c.length));
    store.practiceCards().then((c) => setActive(c.length));
  }, [store, version]);

  return (
    <div>
      <h1>Nauka</h1>
      <div className="mode-grid">
        <button className="mode" onClick={onRated} disabled={!due}>
          <span className="mode-icon">★</span>
          <span className="mode-title">Nauka z oceną</span>
          <span className="mode-desc">
            Fiszki zaplanowane na dziś. Oceniasz się od 1 do 5 gwiazdek, a algorytm wyznacza dzień kolejnej powtórki.
            Liczy się do serii.
          </span>
          <span className="mode-count">{due === null ? "" : due > 0 ? `${due} do powtórki` : "Na dziś wszystko zrobione 🎉"}</span>
        </button>
        <button className="mode" onClick={onFree} disabled={active === 0}>
          <span className="mode-icon">↻</span>
          <span className="mode-title">Nauka bez oceny</span>
          <span className="mode-desc">
            Swobodne przeglądanie fiszek z wybranych tagów, bez gwiazdek. Nie zmienia terminów powtórek ani statystyk.
          </span>
          <span className="mode-count">{active} aktywnych fiszek</span>
        </button>
      </div>
    </div>
  );
}
