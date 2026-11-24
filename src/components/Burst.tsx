import { useMemo } from "react";
import { createPortal } from "react-dom";
import { reducedMotion } from "../lib/juice";

const COLORS = ["var(--accent)", "var(--star)", "var(--ok)", "var(--fire)", "#ec4899", "#38bdf8"];

interface Props {
  /** Zmiana klucza odpala nowy wybuch. */
  burstKey: string | number;
  /** Punkt startu w % okna (domyślnie środek, trochę wyżej). */
  x?: number;
  y?: number;
  count?: number;
  /** "small" – krótki błysk przy nauczonej fiszce, "big" – konfetti na koniec sesji. */
  size?: "small" | "big";
}

/** Konfetti z czystego CSS: każda drobinka dostaje losowy kierunek, obrót i kolor przez zmienne CSS. */
export default function Burst({ burstKey, x = 50, y = 40, count = 28, size = "big" }: Props) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = (size === "big" ? 9 : 4.5) + Math.random() * (size === "big" ? 9 : 4);
        return {
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - (size === "big" ? 4 : 1.5),
          rot: Math.round(Math.random() * 720 - 360),
          color: COLORS[i % COLORS.length],
          delay: Math.random() * 80,
          round: i % 3 === 0,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [burstKey, count, size],
  );
  if (reducedMotion()) return null;
  return createPortal(
    <div key={burstKey} className={`burst burst-${size}`} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">
      {bits.map((b, i) => (
        <i
          key={i}
          className={b.round ? "round" : ""}
          style={
            {
              "--dx": `${b.dx}rem`,
              "--dy": `${b.dy}rem`,
              "--rot": `${b.rot}deg`,
              background: b.color,
              animationDelay: `${b.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>,
    document.body,
  );
}
