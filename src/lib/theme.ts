export type Theme = "system" | "light" | "dark";
const KEY = "fiszki-motyw";

export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* brak localStorage */
  }
  return "system";
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* ignorujemy */
  }
}
