import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { alignMathLines, convertFractions, splitMath } from "../lib/math";

/** Tekst fiszki: zwykły tekst + wzory $…$ / $$…$$ (KaTeX, działa offline). */
export default function RichText({ text }: { text: string }) {
  const parts = useMemo(
    () =>
      splitMath(alignMathLines(text)).map((s) =>
        s.type === "text"
          ? s
          : {
              ...s,
              html: katex.renderToString((s.display ? "" : "\\displaystyle ") + convertFractions(s.value), {
                displayMode: s.display,
                throwOnError: false,
                strict: "ignore",
                output: "html",
              }),
            },
      ),
    [text],
  );
  return (
    <>
      {parts.map((p, i) =>
        p.type === "text" ? (
          <span key={i}>{p.value}</span>
        ) : (
          <span key={i} className={p.display ? "math math-display" : "math"} dangerouslySetInnerHTML={{ __html: p.html }} />
        ),
      )}
    </>
  );
}
