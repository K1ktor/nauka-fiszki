import { useMemo, useState } from "react";
import { Store } from "../lib/db";
import { parseCsv, parseTags } from "../lib/csv";

interface Props {
  store: Store;
  onImported: () => void;
}

const EXAMPLE = `pytanie,odpowiedź,tagi
Stolica Australii?,Canberra,geografia
"Co oznacza skrót ""DNA""?",Kwas deoksyrybonukleinowy,biologia
Ile wynosi pierwiastek z 144?,12,matematyka
Kto napisał „Pana Tadeusza”?,Adam Mickiewicz,literatura|polski
`;

export default function ImportView({ store, onImported }: Props) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [extraTags, setExtraTags] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseCsv(text) : null), [text]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setResult(null);
    setText(await f.text());
    // Domyślny tag z nazwy pliku, np. "biologia.csv" → biologia
    if (!extraTags) setExtraTags(f.name.replace(/\.[^.]+$/, ""));
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true);
    const r = await store.addCards(parsed.cards, parseTags(extraTags));
    setBusy(false);
    setResult(`Dodano ${r.added} fiszek${r.duplicates ? `, pominięto ${r.duplicates} duplikatów` : ""}.`);
    setText("");
    setFileName("");
    if (r.added > 0) setTimeout(onImported, 900);
  };

  return (
    <div>
      <h1>Import fiszek z CSV</h1>
      <section className="panel">
        <p>
          Każdy wiersz to jedna fiszka: <code>pytanie,odpowiedź</code>. Opcjonalnie trzecia kolumna z tagami
          rozdzielonymi <code>|</code>. Separator (przecinek, średnik lub tabulator) jest wykrywany automatycznie, a
          pola z przecinkami możesz ująć w cudzysłowy.
        </p>
        <pre className="example">{EXAMPLE}</pre>
        <button className="link" onClick={() => { setText(EXAMPLE); setResult(null); }}>Wstaw przykład do pola poniżej</button>
      </section>

      <section className="panel">
        <label className="file-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
          <input type="file" accept=".csv,.txt,.tsv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          <span>{fileName ? `📄 ${fileName}` : "Wybierz plik CSV lub przeciągnij go tutaj"}</span>
        </label>
        <p className="muted small">…albo wklej treść:</p>
        <textarea className="paste" value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} placeholder="pytanie,odpowiedź" />
        <label className="inline">
          Dodaj tagi do wszystkich importowanych fiszek:
          <input value={extraTags} onChange={(e) => setExtraTags(e.target.value)} placeholder="np. angielski, rozdział 1" />
        </label>
      </section>

      {parsed && (
        <section className="panel">
          <div className="panel-head">
            <h2>Podgląd: {parsed.cards.length} fiszek</h2>
            <button className="primary" disabled={busy || parsed.cards.length === 0} onClick={doImport}>
              {busy ? "Importuję…" : `Importuj ${parsed.cards.length}`}
            </button>
          </div>
          {parsed.skipped.length > 0 && (
            <p className="warn">
              Pominięte wiersze: {parsed.skipped.slice(0, 10).map((s) => `${s.line} (${s.reason})`).join(", ")}
              {parsed.skipped.length > 10 ? "…" : ""}
            </p>
          )}
          <table className="preview">
            <thead><tr><th>Pytanie</th><th>Odpowiedź</th><th>Tagi</th></tr></thead>
            <tbody>
              {parsed.cards.slice(0, 20).map((c, i) => (
                <tr key={i}><td>{c.question}</td><td>{c.answer}</td><td>{[...c.tags, ...parseTags(extraTags)].map((t) => "#" + t).join(" ")}</td></tr>
              ))}
            </tbody>
          </table>
          {parsed.cards.length > 20 && <p className="muted small">…i {parsed.cards.length - 20} więcej</p>}
        </section>
      )}
      {result && <div className="success">{result}</div>}
    </div>
  );
}
