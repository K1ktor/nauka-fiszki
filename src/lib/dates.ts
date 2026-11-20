/** Daty przechowujemy jako lokalne dni w formacie YYYY-MM-DD (bez strefy czasowej). */
export type DayString = string;

export function toDay(d: Date = new Date()): DayString {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDay(s: DayString): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: DayString, n: number): DayString {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Liczba dni od a do b (b - a). */
export function diffDays(a: DayString, b: DayString): number {
  const ms = parseDay(b).getTime() - parseDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function formatInterval(days: number): string {
  if (days <= 0) return "dziś";
  if (days === 1) return "jutro";
  if (days < 30) return `za ${days} dni`;
  const months = Math.round(days / 30);
  if (days < 365) return `za ~${months} mies.`;
  return `za ~${(days / 365).toFixed(1)} r.`;
}
