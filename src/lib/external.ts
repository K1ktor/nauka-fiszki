import { isTauri } from "./drivers";

export const CHATGPT_URL = "https://chatgpt.com/";
export const CLAUDE_URL = "https://claude.ai/new";

/** Otwiera stronę w domyślnej przeglądarce (w aplikacji przez Rust, w przeglądarce w nowej karcie). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url });
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** Kopiuje tekst do schowka; zwraca false, gdy się nie udało. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
