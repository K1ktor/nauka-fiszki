import { isTauri } from "./drivers";

/**
 * Zapisuje tekst do pliku. W aplikacji: okno „Zapisz jako” i zapis przez Rust.
 * W przeglądarce: zwykłe pobranie pliku. Zwraca ścieżkę/nazwę albo null, gdy anulowano.
 */
export async function saveTextFile(defaultName: string, contents: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_text_file", { path, contents });
    return path;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return defaultName;
}
