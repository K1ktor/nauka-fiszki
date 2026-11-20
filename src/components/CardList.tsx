import { useEffect, useMemo, useState } from "react";
import { Card, Store, TagInfo } from "../lib/db";
import { diffDays, formatInterval, toDay } from "../lib/dates";
import { parseTags } from "../lib/csv";

interface Props {
  store: Store;
  version: number;
  onChange: () => void;
}

interface Draft {
  id: number | null;
  question: string;
  answer: string;
  tags: string;
}

type Status = "all" | "active" | "suspended";

export default function CardList({ store, version, onChange }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const today = toDay();

  useEffect(() => {
    store.listCards().then((all) => {
      setCards(all);
      // Usuń z zaznaczenia fiszki, których już nie ma.
      setSelected((sel) => new Set([...sel].filter((id) => all.some((c) => c.id === id))));
    });
    store.listTags(today).then(setTags);
  }, [store, version, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter(
      (c) =>
        (!tag || c.tags.includes(tag)) &&
        (status === "all" || (status === "suspended") === c.suspended) &&
        (!q || c.question.toLowerCase().includes(q) || c.answer.toLowerCase().includes(q)),
    );
  }, [cards, query, tag, status]);

  const visibleSelected = filtered.filter((c) => selected.has(c.id));
  const allSelected = filtered.length > 0 && visibleSelected.length === filtered.length;
  const someSelected = visibleSelected.length > 0 && !allSelected;
  const selectedSuspended = visibleSelected.filter((c) => c.suspended).length;

  useEffect(() => setConfirmDelete(false), [selected, filtered]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) filtered.forEach((c) => n.delete(c.id));
      else filtered.forEach((c) => n.add(c.id));
      return n;
    });

  const ids = () => visibleSelected.map((c) => c.id);

  const suspend = async (value: boolean) => {
    await store.setSuspended(ids(), value);
    onChange();
  };

  const removeSelected = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await store.deleteCards(ids());
    setSelected(new Set());
    onChange();
  };

  const save = async () => {
    if (!draft || !draft.question.trim() || !draft.answer.trim()) return;
    const t = parseTags(draft.tags);
    if (draft.id === null) {
      await store.addCards([{ question: draft.question, answer: draft.answer, tags: t }]);
    } else {
      await store.updateCard(draft.id, draft.question, draft.answer, t);
    }
    setDraft(null);
    onChange();
  };

  const suspendedCount = cards.filter((c) => c.suspended).length;

  return (
    <div>
      <div className="panel-head">
        <h1>Fiszki</h1>
        <button className="primary" onClick={() => setDraft({ id: null, question: "", answer: "", tags: tag })}>
          + Nowa fiszka
        </button>
      </div>
      <div className="toolbar">
        <input placeholder="Szukaj w pytaniach i odpowiedziach…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Wszystkie tagi</option>
          {tags.map((t) => (
            <option key={t.name} value={t.name}>#{t.name} ({t.count})</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          <option value="all">Wszystkie fiszki</option>
          <option value="active">Aktywne</option>
          <option value="suspended">Uśpione ({suspendedCount})</option>
        </select>
      </div>

      <div className="bulkbar">
        <label className="check">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={toggleAll}
            disabled={filtered.length === 0}
          />
          Zaznacz wszystkie
        </label>
        <span className="muted small">
          {visibleSelected.length > 0 ? `zaznaczono ${visibleSelected.length} z ${filtered.length}` : `${filtered.length} z ${cards.length} fiszek`}
        </span>
        <div className="bulk-actions">
          {selectedSuspended < visibleSelected.length && (
            <button onClick={() => suspend(true)} disabled={visibleSelected.length === 0}>💤 Uśpij</button>
          )}
          {selectedSuspended > 0 && <button onClick={() => suspend(false)}>☀️ Obudź</button>}
          <button className={confirmDelete ? "danger-btn" : ""} onClick={removeSelected} disabled={visibleSelected.length === 0}>
            {confirmDelete ? `Na pewno usunąć ${visibleSelected.length}?` : "🗑 Usuń"}
          </button>
        </div>
      </div>

      <div className="card-list">
        {filtered.map((c) => {
          const d = diffDays(today, c.dueDate);
          return (
            <div key={c.id} className={`row ${selected.has(c.id) ? "selected" : ""} ${c.suspended ? "is-suspended" : ""}`}>
              <input type="checkbox" className="row-check" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label="Zaznacz fiszkę" />
              <div className="row-main">
                <div className="row-q">{c.question}</div>
                <div className="row-a muted">{c.answer}</div>
                <div className="row-tags">
                  {c.tags.map((t) => (
                    <button key={t} className="chip small" onClick={() => setTag(t)}>#{t}</button>
                  ))}
                </div>
              </div>
              <div className="row-side">
                {c.suspended ? (
                  <span className="due sleeping">💤 uśpiona</span>
                ) : (
                  <span className={d <= 0 ? "due now" : "due"}>{c.lastReviewed === null ? "nowa" : d < 0 ? "zaległa" : formatInterval(d)}</span>
                )}
                {c.avgStars !== null && (
                  <span className="avg-stars" title={`Średnia z ${c.ratings} ocen`}>
                    {c.avgStars.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}★
                  </span>
                )}
                <div className="row-actions">
                  <button className="link" onClick={() => setDraft({ id: c.id, question: c.question, answer: c.answer, tags: c.tags.join(", ") })}>edytuj</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {draft && (
        <div className="modal-bg" onClick={() => setDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{draft.id === null ? "Nowa fiszka" : "Edytuj fiszkę"}</h2>
            <label>Pytanie<textarea autoFocus value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></label>
            <label>Odpowiedź<textarea value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} /></label>
            <label>Tagi (oddzielone przecinkami)<input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="np. biologia, komórka" /></label>
            <div className="modal-actions">
              <button onClick={() => setDraft(null)}>Anuluj</button>
              <button className="primary" onClick={save} disabled={!draft.question.trim() || !draft.answer.trim()}>Zapisz</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
