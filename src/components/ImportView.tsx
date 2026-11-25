import { useMemo, useState } from "react";
import { Store } from "../lib/db";
import { parseCsv, parseTags } from "../lib/csv";
import { CHATGPT_URL, CLAUDE_URL, copyText, openExternal } from "../lib/external";
import { CLAUDE_COLOR, CLAUDE_PATH, OPENAI_PATH } from "../lib/logos";
import { sfx } from "../lib/sounds";
import RichText from "./RichText";

interface Props {
  store: Store;
  onImported: () => void;
}

export const AI_PROMPT = `Z materiałów, które wkleję poniżej, utwórz fiszki do nauki.
Zwróć wyłącznie dane CSV – bez komentarzy, nagłówka i bloku kodu – po jednej fiszce w wierszu, w formacie:
"pytanie","odpowiedź","tagi"
Zasady:
- każde pole ujmij w cudzysłów, a cudzysłów wewnątrz pola zapisz podwójnie ("")
- kilka tagów oddziel znakiem |, np. "biologia|komórka"
- jedno pytanie sprawdza jedną rzecz, odpowiedź jest krótka i konkretna
- pisz w języku materiałów
- wzory i działania matematyczne zapisuj w LaTeX między znakami dolara, np. "$1/2 + 1/3 = 5/6$", "$x^2$", "$\\sqrt{2}$"; ułamek pisz jako a/b, np. "$(a+b)/c$"; zwykły tekst zostaw bez dolarów
Materiały:
`;

function Logo({ path, color }: { path: string; color?: string }) {
  return (
    <svg className="ai-logo" viewBox="0 0 24 24" aria-hidden="true" style={color ? { color } : undefined}>
      <path d={path} fill="currentColor" />
    </svg>
  );
}

export default function ImportView({ store, onImported }: Props) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [extraTags, setExtraTags] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const copyPrompt = async () => {
    const ok = await copyText(AI_PROMPT);
    setAiNote(ok ? "Prompt skopiowany – wklej go w czacie (Ctrl+V), a pod nim swoje notatki." : "Nie udało się skopiować – zaznacz prompt i skopiuj ręcznie.");
  };

  const openChat = async (url: string) => {
    await copyPrompt();
    try {
      await openExternal(url);
    } catch (e) {
      setAiNote(`Nie udało się otworzyć przeglądarki: ${e}`);
    }
  };

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
    if (r.added > 0) {
      sfx("dodano");
      setTimeout(onImported, 900);
    }
  };

  return (
    <div>
      <section className="panel ai-hint">
        <div className="ai-hint-head">
          <div>
            <h2>✨ Nie masz pliku? Wygeneruj go z AI</h2>
            <p className="muted">
              Masz notatki, rozdział podręcznika albo listę pojęć? Wklej je do ChatGPT lub Claude razem z promptem poniżej –
              dostaniesz gotowe dane CSV, które wkleisz tutaj w pole importu.
            </p>
          </div>
          <div className="ai-buttons">
            <button className="ai-btn" onClick={() => openChat(CHATGPT_URL)} title="Kopiuje prompt i otwiera chatgpt.com w przeglądarce">
              <Logo path={OPENAI_PATH} /> ChatGPT
            </button>
            <button className="ai-btn" onClick={() => openChat(CLAUDE_URL)} title="Kopiuje prompt i otwiera claude.ai w przeglądarce">
              <Logo path={CLAUDE_PATH} color={CLAUDE_COLOR} /> Claude
            </button>
          </div>
        </div>
        <pre className="example ai-prompt">{AI_PROMPT}</pre>
        <div className="ai-foot">
          <button onClick={copyPrompt}>📋 Kopiuj prompt</button>
          <span className="muted small">{aiNote ?? "Przyciski czatów też kopiują prompt. Wynik z czatu wklej w pole poniżej."}</span>
        </div>
      </section>

      <section className="panel">
        <label className="file-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
          <input type="file" accept=".csv,.txt,.tsv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          <span>{fileName ? `📄 ${fileName}` : "Wybierz plik CSV lub przeciągnij go tutaj"}</span>
        </label>
        <p className="muted small">
          …albo wklej treść. Każdy wiersz to jedna fiszka: <code>pytanie,odpowiedź,tagi</code> (tagi opcjonalne, rozdzielone <code>|</code>).
        </p>
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
                <tr key={i}><td><RichText text={c.question} /></td><td><RichText text={c.answer} /></td><td>{[...c.tags, ...parseTags(extraTags)].map((t) => "#" + t).join(" ")}</td></tr>
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
