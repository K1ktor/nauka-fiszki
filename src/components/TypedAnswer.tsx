import { compareAnswer } from "../lib/answer";

/** Wpisana odpowiedź pokazana po odsłonięciu, z oznaczeniem zgodności. */
export default function TypedAnswer({ typed, answer }: { typed: string; answer: string }) {
  const verdict = compareAnswer(typed, answer);
  const label =
    verdict === "exact" ? "✓ Zgadza się" : verdict === "close" ? "≈ Prawie (sprawdź znaki)" : verdict === "empty" ? "Nic nie wpisano" : "✗ Inaczej niż w odpowiedzi";
  return (
    <div className={`typed ${verdict}`}>
      <div className="side-label">Twoja odpowiedź · {label}</div>
      <div className="typed-text">{typed.trim() || "—"}</div>
    </div>
  );
}
