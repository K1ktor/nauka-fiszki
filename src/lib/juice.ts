import { useEffect, useRef, useState } from "react";

/** Czy użytkownik prosi system o ograniczenie ruchu (Windows: „Pokaż animacje” wyłączone). */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Liczba „dobiega” do wartości docelowej (ease-out). Przy ograniczonym ruchu od razu pokazuje wynik. */
export function useCountUp(target: number, ms = 700): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? target : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = Math.round(a + (target - a) * (1 - Math.pow(1 - t, 3)));
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}

/** Czeka `ms`, chyba że ruch jest ograniczony – wtedy nie spowalnia aplikacji. */
export function settle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));
}
