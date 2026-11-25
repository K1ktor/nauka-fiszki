/**
 * Wzory matematyczne w treści fiszek.
 *
 * Składnia: $…$ – wzór w tekście, $$…$$ – wzór w osobnej linii (LaTeX, renderowany przez KaTeX).
 * Wewnątrz wzoru skrót a/b zamienia się na ułamek (\frac{a}{b}); nawiasy wokół licznika/mianownika
 * znikają: $(a+b)/(c-d)$. Zwykły ukośnik w tekście poza $…$ (np. „i/lub”) zostaje bez zmian.
 * Dolar jako znak: \$ (albo „5 $” – dolar ze spacją po nim nie otwiera wzoru).
 */

export type Segment = { type: "text"; value: string } | { type: "math"; value: string; display: boolean };

/** Dzieli tekst na fragmenty zwykłe i wzory. */
export function splitMath(text: string): Segment[] {
  const out: Segment[] = [];
  let buf = "";
  let i = 0;
  const pushText = () => {
    if (buf) out.push({ type: "text", value: buf });
    buf = "";
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }
    if (ch === "$") {
      const display = text[i + 1] === "$";
      const open = display ? 2 : 1;
      const end = findClose(text, i + open, display);
      if (end !== -1) {
        const body = text.slice(i + open, end);
        if (display ? body.trim() !== "" : body !== "" && !/^\s/.test(body) && !/\s$/.test(body)) {
          pushText();
          out.push({ type: "math", value: body.trim(), display });
          i = end + open;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  pushText();
  return out;
}

function findClose(text: string, from: number, display: boolean): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] !== "$") continue;
    if (display) {
      if (text[j + 1] === "$") return j;
    } else if (!/\d/.test(text[j + 1] ?? "")) {
      // „$5 i $6” to nie wzór: zamykający $ nie może stać tuż przed cyfrą.
      return j;
    }
  }
  return -1;
}

/** Czy tekst zawiera choć jeden wzór. */
export const hasMath = (text: string) => splitMath(text).some((s) => s.type === "math");

/** Tekst do porównań (np. wpisana odpowiedź): wzory bez znaczników $. */
export const mathAsPlain = (text: string) =>
  splitMath(text)
    .map((s) => s.value)
    .join("");

// --- skrót a/b → \frac{a}{b} ---------------------------------------------

type Tok = { kind: "atom"; tex: string; inner?: string } | { kind: "other"; tex: string };

const isSpace = (c: string) => c === " " || c === "\t" || c === "\n";

/** Odczytuje zbalansowaną grupę od pozycji i (text[i] to nawias otwierający). Zwraca indeks za zamknięciem. */
function readGroup(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j + 1;
  }
  return -1;
}

/** Indeks i dopisek ^…/_… za atomem (np. x^2, a_{n+1}). */
function readScripts(s: string, i: number): number {
  while (s[i] === "^" || s[i] === "_") {
    const j = i + 1;
    if (s[j] === "{") {
      const e = readGroup(s, j, "{", "}");
      if (e === -1) return i;
      i = e;
    } else if (s[j] === "\\") {
      const m = /^\\[a-zA-Z]+/.exec(s.slice(j));
      i = m ? j + m[0].length : j + 2;
    } else if (j < s.length) {
      i = j + 1;
    } else return i;
  }
  return i;
}

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    let end = -1;
    let inner: string | undefined;
    if (c === "(" || c === "{") {
      const close = c === "(" ? ")" : "}";
      end = readGroup(s, i, c, close);
      if (end !== -1) {
        inner = s.slice(i + 1, end - 1);
        const fixed = convertFractions(inner);
        const tex = c === "(" ? `(${fixed})` : `{${fixed}}`;
        const after = readScripts(s, end);
        if (after !== end) {
          toks.push({ kind: "atom", tex: tex + convertFractions(s.slice(end, after)) });
          i = after;
        } else {
          toks.push({ kind: "atom", tex, inner: fixed });
          i = end;
        }
        continue;
      }
    }
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      if (m) {
        end = i + m[0].length;
        if (/^\\(left|right|big|Big|bigg|Bigg)[lr]?$/.test(m[0])) {
          // \left( … – nawias jako zwykły znak, bez łączenia w ułamek.
          toks.push({ kind: "other", tex: m[0] });
          i = end;
          continue;
        }
        // argumenty komendy: \sqrt{2}, \frac{a}{b}, \sqrt[3]{x}
        while (s[end] === "{" || (s[end] === "[" && /^\\sqrt$/.test(m[0]))) {
          const e = s[end] === "{" ? readGroup(s, end, "{", "}") : readGroup(s, end, "[", "]");
          if (e === -1) break;
          end = e;
        }
        const isAtom = /^\\[a-zA-Z]+$/.test(m[0]);
        const after = readScripts(s, end);
        const raw = s.slice(i, after);
        // argumenty komend też mogą zawierać skrót a/b
        const tex = raw.replace(/\{([^{}]*)\}/g, (_, x: string) => `{${convertFractions(x)}}`);
        toks.push(isAtom ? { kind: "atom", tex } : { kind: "other", tex });
        i = after;
        continue;
      }
    }
    const m = /^[\p{L}\p{N}]+(?:[.,]\d+)?/u.exec(s.slice(i));
    if (m) {
      const wordEnd = i + m[0].length;
      let tex = m[0];
      end = wordEnd;
      // wywołanie funkcji: f(x)/2 → \frac{f(x)}{2}
      if (s[end] === "(") {
        const e = readGroup(s, end, "(", ")");
        if (e !== -1) {
          tex += `(${convertFractions(s.slice(end + 1, e - 1))})`;
          end = e;
        }
      }
      const after = readScripts(s, end);
      toks.push({ kind: "atom", tex: tex + convertFractions(s.slice(end, after)) });
      i = after;
      continue;
    }
    toks.push({ kind: "other", tex: c });
    i++;
  }
  return toks;
}

/** Zamienia a/b na \frac{a}{b} w kodzie wzoru (łączy od lewej: a/b/c = (a/b)/c). */
export function convertFractions(tex: string): string {
  const toks = tokenize(tex);
  const out: Tok[] = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === "other" && t.tex === "/") {
      // pomiń spacje wokół ukośnika
      let o = out.length - 1;
      while (o >= 0 && out[o].kind === "other" && isSpace(out[o].tex)) o--;
      let n = k + 1;
      while (n < toks.length && toks[n].kind === "other" && isSpace(toks[n].tex)) n++;
      const left = out[o];
      const right = toks[n];
      if (left?.kind === "atom" && right?.kind === "atom") {
        out.length = o;
        out.push({ kind: "atom", tex: `\\frac{${operand(left)}}{${operand(right)}}` });
        k = n;
        continue;
      }
    }
    out.push(t);
  }
  return out.map((t) => t.tex).join("");
}

const operand = (t: Tok) => (t.kind === "atom" && t.inner !== undefined ? t.inner : t.tex);

// --- kilka linii obliczeń pod rząd → jeden blok z wyrównanymi „=” -------------

/** Indeks pierwszego „=” poza nawiasami/klamrami, albo -1. */
function topLevelEq(tex: string): number {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "=" && depth === 0) return i;
  }
  return -1;
}

/**
 * Linie, które w całości są jednym wzorem $…$ i stoją bezpośrednio pod sobą (min. 2),
 * łączy w jeden blok \begin{aligned}: znaki „=” stoją jeden pod drugim, a między liniami jest odstęp.
 */
export function alignMathLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let group: string[] = [];
  const flush = () => {
    if (group.length >= 2) {
      const rows = group.map((tex) => {
        const eq = topLevelEq(tex);
        return eq === -1 ? `&${tex}` : `${tex.slice(0, eq)}&${tex.slice(eq)}`;
      });
      out.push(`$$\\begin{aligned}${rows.join("\\\\[0.6em]")}\\end{aligned}$$`);
    } else out.push(...group.map((t) => `$${t}$`));
    group = [];
  };
  for (const line of lines) {
    const segs = splitMath(line.trim());
    if (segs.length === 1 && segs[0].type === "math" && !segs[0].display) group.push(segs[0].value);
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join("\n");
}
