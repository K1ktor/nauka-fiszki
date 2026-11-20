export type AnswerVerdict = "exact" | "close" | "wrong" | "empty";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?"'„”«»()-]+$/g, "")
    .replace(/^[\s"'„”«»(-]+/g, "")
    .trim();

const strip = (s: string) =>
  norm(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** Porównanie wpisanej odpowiedzi z poprawną: bez wielkości liter, spacji na brzegach i końcowej interpunkcji. */
export function compareAnswer(typed: string, answer: string): AnswerVerdict {
  if (typed.trim() === "") return "empty";
  if (norm(typed) === norm(answer)) return "exact";
  if (strip(typed) !== "" && strip(typed) === strip(answer)) return "close";
  return "wrong";
}
