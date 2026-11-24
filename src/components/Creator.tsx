import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Store, TagInfo } from "../lib/db";
import { parseTags } from "../lib/csv";
import { cardsFromDraft, questionKey, toggleTagText } from "../lib/creator";
import { sfx } from "../lib/sounds";

interface Props {
  store: Store;
  onChange: () => void;
  onDone: () => void;
  /** Powrót do importu (przycisk i Esc). */
  onBack: () => void;
  /** Czy kreator jest widoczny – tylko wtedy Esc wraca do importu. */
  active: boolean;
}

/** Fiszka dodana w bieżącej sesji kreatora (najnowsze na górze listy). */
interface Added {
  id: number;
  question: string;
  answer: string;
  tags: string[];
  reverse: boolean;
}

const LS_TAGS = "kreator.tags";
const LS_REVERSE = "kreator.reverse";
const LS_DRAFT = "kreator.draft";

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* brak dostępu do localStorage – trudno */
  }
}

function loadDraft(): { question: string; answer: string } {
  try {
    const d = JSON.parse(lsGet(LS_DRAFT) ?? "");
    return { question: String(d.question ?? ""), answer: String(d.answer ?? "") };
  } catch {
    return { question: "", answer: "" };
  }
}

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

export default function Creator({ store, onChange, onDone, onBack, active }: Props) {
  const initial = useMemo(loadDraft, []);
  const [question, setQuestion] = useState(initial.question);
  const [answer, setAnswer] = useState(initial.answer);
  const [tagText, setTagText] = useState(() => lsGet(LS_TAGS) ?? "");
  const [reverse, setReverse] = useState(() => lsGet(LS_REVERSE) === "1");
  const [editing, setEditing] = useState<Added | null>(null);
  const [added, setAdded] = useState<Added[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qRef = useRef<HTMLTextAreaElement>(null);
  // Tagi serii sprzed rozpoczęcia edycji – wracają po jej zakończeniu.
  const seriesTags = useRef<string | null>(null);

  useEffect(() => {
    store.listCards().then((cards) => setExisting(new Set(cards.map((c) => questionKey(c.question)))));
    store.listTags().then(setAllTags);
  }, [store]);

  // Tagi i opcja „odwrotna” zostają między fiszkami (i po zamknięciu aplikacji),
  // a niedokończona fiszka nie ginie po przejściu do innej zakładki.
  useEffect(() => lsSet(LS_TAGS, tagText), [tagText]);
  useEffect(() => lsSet(LS_REVERSE, reverse ? "1" : "0"), [reverse]);
  useEffect(() => {
    if (editing) return;
    lsSet(LS_DRAFT, question || answer ? JSON.stringify({ question, answer }) : null);
  }, [question, answer, editing]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const tags = useMemo(() => parseTags(tagText), [tagText]);
  const ownKey = editing ? questionKey(editing.question) : null;
  const duplicate = question.trim() !== "" && questionKey(question) !== ownKey && existing.has(questionKey(question));
  const canSave = question.trim() !== "" && answer.trim() !== "" && !duplicate && !busy;

  // Podpowiedzi: najczęściej używane tagi + te, które użytkownik właśnie wpisał.
  const suggestions = useMemo(() => {
    const names = [...allTags].sort((a, b) => b.count - a.count).map((t) => t.name);
    for (const t of tags) if (!names.includes(t)) names.unshift(t);
    return names.slice(0, 14);
  }, [allTags, tags]);

  const stopEdit = () => {
    const draft = loadDraft();
    setEditing(null);
    setQuestion(draft.question);
    setAnswer(draft.answer);
    if (seriesTags.current !== null) setTagText(seriesTags.current);
    seriesTags.current = null;
  };

  const clear = () => {
    if (editing) stopEdit();
    else {
      setQuestion("");
      setAnswer("");
    }
    qRef.current?.focus();
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      if (editing) {
        await store.updateCard(editing.id, question, answer, tags);
        const updated: Added = { ...editing, question: question.trim(), answer: answer.trim(), tags };
        setAdded((list) => list.map((a) => (a.id === editing.id ? updated : a)));
        setExisting((s) => {
          const n = new Set(s);
          n.delete(questionKey(editing.question));
          n.add(questionKey(question));
          return n;
        });
        setFlash("Zapisano zmiany");
        stopEdit();
      } else {
        const cards = cardsFromDraft(question, answer, tags, reverse);
        const r = await store.addCards(cards);
        if (r.added === 0) {
          setFlash("Taka fiszka już istnieje");
          return;
        }
        sfx("dodano");
        const now: Added[] = r.ids.map((id, i) => ({ id, ...cards[i], reverse: i > 0 }));
        // Gdy odwrotna była duplikatem, addCards ją pominął – ids ma wtedy tylko pierwszą.
        setAdded((list) => [...now.slice().reverse(), ...list]);
        setExisting((s) => new Set([...s, ...cards.map((c) => questionKey(c.question))]));
        setFlash(r.added === 2 ? "Dodano fiszkę i jej odwrotność" : r.duplicates ? "Dodano fiszkę (odwrotna już istniała)" : "Dodano fiszkę");
        setQuestion("");
        setAnswer("");
      }
      store.listTags().then(setAllTags);
      onChange();
    } finally {
      setBusy(false);
      qRef.current?.focus();
    }
  };

  const startEdit = (a: Added) => {
    if (seriesTags.current === null) seriesTags.current = tagText;
    setEditing(a);
    setQuestion(a.question);
    setAnswer(a.answer);
    setTagText(a.tags.join(", "));
    qRef.current?.focus();
  };

  const remove = async (a: Added) => {
    await store.deleteCards([a.id]);
    setAdded((list) => list.filter((x) => x.id !== a.id));
    setExisting((s) => {
      const n = new Set(s);
      n.delete(questionKey(a.question));
      return n;
    });
    if (editing?.id === a.id) stopEdit();
    onChange();
  };

  // Esc poza edycją wraca do importu (edycję Esc tylko anuluje – obsługa niżej ustawia preventDefault).
  useEffect(() => {
    if (!active) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onBack();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [active, onBack]);

  useEffect(() => {
    if (active) qRef.current?.focus();
  }, [active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape" && editing) {
      e.preventDefault();
      stopEdit();
    }
  };

  return (
    <div className="creator" onKeyDown={onKeyDown}>
      <section className={editing ? "panel creator-editor editing" : "panel creator-editor"}>
        <div className="creator-head">
          <h2>{editing ? "Edytujesz fiszkę" : `Fiszka nr ${added.filter((a) => !a.reverse).length + 1}`}</h2>
          {flash && <span className="creator-flash" role="status">✓ {flash}</span>}
        </div>

        <div className="creator-sides">
          <label className="creator-side">
            <span className="side-label">Przód · pytanie</span>
            <textarea
              ref={qRef}
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="np. Stolica Australii?"
            />
          </label>
          <label className="creator-side">
            <span className="side-label">Tył · odpowiedź</span>
            <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="np. Canberra" />
          </label>
        </div>
        {duplicate && <p className="warn">Fiszka z takim pytaniem już istnieje – zmień pytanie, żeby ją dodać.</p>}

        <div className="creator-tags">
          <label className="inline">
            <span>Tagi <span className="small">– zostają dla kolejnych fiszek</span></span>
            <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="np. angielski, rozdział 1" />
          </label>
          {suggestions.length > 0 && (
            <div className="chips">
              {suggestions.map((t) => (
                <button key={t} className={tags.includes(t) ? "chip small on" : "chip small"} onClick={() => setTagText(toggleTagText(tagText, t))} tabIndex={-1}>
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="creator-actions">
          {editing ? (
            <span className="muted small">Esc – anuluj edycję</span>
          ) : (
            <label className="check small" title="Np. przy słówkach: druga fiszka pyta o odpowiedź i oczekuje pytania">
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              Dodaj też odwrotną (tył → przód)
            </label>
          )}
          <div className="creator-buttons">
            <button onClick={clear} disabled={!question && !answer && !editing}>
              {editing ? "Anuluj" : "Wyczyść"}
            </button>
            <button className="primary" onClick={save} disabled={!canSave}>
              {editing ? "Zapisz zmiany" : "Zapisz i następna"} <kbd>{MOD}+Enter</kbd>
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{added.length ? `Dodane teraz: ${added.length}` : "Dodane teraz"}</h2>
          {added.length > 0 && <button onClick={onDone}>Gotowe → lista fiszek</button>}
        </div>
        {added.length === 0 ? (
          <p className="muted small">
            Wpisz pytanie, naciśnij <kbd className="plain">Tab</kbd>, wpisz odpowiedź i <kbd className="plain">{MOD}+Enter</kbd>. Nowe
            fiszki pojawią się tutaj – możesz je od razu poprawić albo usunąć.
          </p>
        ) : (
          <div className="card-list">
            {added.map((a) => (
              <div key={a.id} className={editing?.id === a.id ? "row selected" : "row"}>
                <div className="row-main">
                  <div className="row-q">{a.question}</div>
                  <div className="row-a muted">{a.answer}</div>
                  {(a.tags.length > 0 || a.reverse) && (
                    <div className="row-tags">
                      {a.reverse && <span className="chip small">⇄ odwrotna</span>}
                      {a.tags.map((t) => (
                        <span key={t} className="chip small">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="row-side">
                  <div className="row-actions">
                    <button className="link" onClick={() => startEdit(a)}>edytuj</button>
                    <button className="link danger" onClick={() => remove(a)}>usuń</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
