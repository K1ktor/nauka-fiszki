export type Theme = "system" | "light" | "dark" | "violet";
const KEY = "fiszki-motyw";

/** Domyślny motyw, gdy użytkownik jeszcze nic nie wybrał. */
export const DEFAULT_THEME: Theme = "dark";

export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark" || t === "system" || t === "violet") return t;
  } catch {
    /* brak localStorage */
  }
  return DEFAULT_THEME;
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    // Zapisujemy też „system”, bo brak wpisu oznacza teraz motyw domyślny (ciemny).
    localStorage.setItem(KEY, t);
  } catch {
    /* ignorujemy */
  }
}
