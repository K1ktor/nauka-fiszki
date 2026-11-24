/**
 * Dźwięki interfejsu. Pliki leżą w `src/assets/dzwieki/` jako `<akcja>-<n>.mp3` (albo .ogg/.wav);
 * przy każdym odtworzeniu losowany jest jeden wariant danej akcji (bez powtórzenia poprzedniego).
 * Żeby podmienić dźwięk, wrzuć plik pod tą samą nazwą. Można też dodać więcej wariantów (-4, -5…).
 */

export type Sfx =
  | "odkryj" // odkrycie odpowiedzi
  | "ocena_slaba" // ocena 1–2★
  | "ocena_srednia" // ocena 3★
  | "ocena_dobra" // ocena 4–5★
  | "nauczona" // fiszka przeszła z Nauki do Powtórki
  | "koniec_sesji" // koniec sesji nauki / powtórki / swobodnej
  | "dodano" // dodanie lub import fiszek
  | "przerwa"; // okienko z propozycją przerwy (dzienny limit)

const files = import.meta.glob("../assets/dzwieki/*.{mp3,ogg,wav}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

const VARIANTS: Partial<Record<Sfx, string[]>> = {};
for (const [path, url] of Object.entries(files)) {
  const name = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  const action = name.replace(/-\d+$/, "") as Sfx;
  (VARIANTS[action] ??= []).push(url);
}

const KEY = "fiszki-dzwieki";
const VOLUME = 0.6;
const last: Partial<Record<Sfx, string>> = {};

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* brak localStorage – ustawienie tylko na tę sesję */
  }
}

/** Odtwarza losowy wariant dźwięku akcji. Brak plików albo zablokowane audio – cisza. */
export function sfx(action: Sfx) {
  if (!soundsEnabled()) return;
  const list = VARIANTS[action];
  if (!list?.length) return;
  const pool = list.length > 1 ? list.filter((u) => u !== last[action]) : list;
  const url = pool[Math.floor(Math.random() * pool.length)];
  last[action] = url;
  try {
    const a = new Audio(url);
    a.volume = VOLUME;
    void a.play().catch(() => {});
  } catch {
    /* brak audio */
  }
}

/** Dźwięk oceny w gwiazdkach. */
export function sfxForStars(stars: number) {
  sfx(stars <= 2 ? "ocena_slaba" : stars === 3 ? "ocena_srednia" : "ocena_dobra");
}
