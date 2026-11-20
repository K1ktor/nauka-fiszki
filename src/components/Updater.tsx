import { useEffect, useState } from "react";
import { isTauri } from "../lib/drivers";

type State =
  | { kind: "idle" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading"; percent: number | null }
  | { kind: "error"; message: string };

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

/**
 * Przy starcie sprawdza, czy na GitHub Releases jest nowsza wersja (latest.json).
 * Jeśli tak, pokazuje pasek z przyciskiem „Zaktualizuj”: pobranie, instalacja i restart aplikacji.
 */
export default function Updater() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [update, setUpdate] = useState<Update>(null);

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const u = await check();
        if (u) {
          setUpdate(u);
          setState({ kind: "available", version: u.version, notes: u.body ?? undefined });
        }
      } catch (e) {
        // Brak internetu lub brak wydania – nie przeszkadzamy w nauce.
        console.warn("Sprawdzanie aktualizacji nie powiodło się:", e);
      }
    })();
  }, []);

  const install = async () => {
    if (!update) return;
    let total = 0;
    let done = 0;
    setState({ kind: "downloading", percent: null });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          setState({ kind: "downloading", percent: total ? Math.min(100, Math.round((done / total) * 100)) : null });
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  if (state.kind === "idle") return null;

  return (
    <div className="update-bar" role="status">
      {state.kind === "available" && (
        <>
          <span>
            Dostępna nowa wersja <b>{state.version}</b>.
          </span>
          <span className="update-actions">
            <button className="primary" onClick={install}>Zaktualizuj</button>
            <button onClick={() => setState({ kind: "idle" })}>Później</button>
          </span>
        </>
      )}
      {state.kind === "downloading" && (
        <span>Pobieranie aktualizacji{state.percent !== null ? ` – ${state.percent}%` : "…"} Aplikacja uruchomi się ponownie sama.</span>
      )}
      {state.kind === "error" && (
        <>
          <span>Aktualizacja nie powiodła się: {state.message}</span>
          <button onClick={() => setState({ kind: "idle" })}>Zamknij</button>
        </>
      )}
    </div>
  );
}
