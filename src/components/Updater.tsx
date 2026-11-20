import { useEffect, useState } from "react";
import { isTauri } from "../lib/drivers";

type State =
  | { kind: "idle" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading"; percent: number | null; done: number; total: number }
  | { kind: "installing" }
  | { kind: "error"; message: string };

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

/**
 * Przy starcie sprawdza, czy na GitHub Releases jest nowsza wersja (latest.json).
 * Jeśli tak, pokazuje pasek z przyciskiem „Zaktualizuj”: pobranie z paskiem postępu w aplikacji,
 * cicha instalacja (bez okna instalatora, installMode "quiet") i automatyczne ponowne uruchomienie.
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
    setState({ kind: "downloading", percent: null, done: 0, total: 0 });
    try {
      await update.download((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          setState({ kind: "downloading", percent: total ? Math.min(100, (done / total) * 100) : null, done, total });
        }
      });
      setState({ kind: "installing" });
      // Krótka chwila, żeby pasek zdążył pokazać 100%.
      await new Promise((r) => setTimeout(r, 400));
      // Windows: instalator działa w tle bez okna i sam uruchamia aplikację ponownie (aplikacja się zamyka).
      await update.install();
      // Inne systemy: restart ręcznie.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  const mb = (n: number) => (n / 1024 / 1024).toLocaleString("pl-PL", { maximumFractionDigits: 1 });

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
      {(state.kind === "downloading" || state.kind === "installing") && (
        <div className="update-progress">
          <div className="update-progress-text">
            <span>
              {state.kind === "installing"
                ? "Instalowanie… aplikacja za chwilę uruchomi się ponownie."
                : `Pobieranie aktualizacji ${update?.version ?? ""}`}
            </span>
            {state.kind === "downloading" && (
              <span className="muted">
                {state.percent !== null ? `${Math.floor(state.percent)}% · ${mb(state.done)} / ${mb(state.total)} MB` : `${mb(state.done)} MB`}
              </span>
            )}
          </div>
          <div className="update-track">
            <div
              className={`update-fill ${state.kind === "downloading" && state.percent === null ? "indeterminate" : ""}`}
              style={{ width: state.kind === "installing" ? "100%" : state.percent !== null ? `${state.percent}%` : "30%" }}
            />
          </div>
        </div>
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
