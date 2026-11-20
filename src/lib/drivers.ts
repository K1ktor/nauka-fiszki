import type { SqlDriver } from "./db";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** SQLite w pliku fiszki.db w katalogu danych aplikacji (Tauri). */
export async function tauriDriver(): Promise<SqlDriver> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load("sqlite:fiszki.db");
  return {
    async execute(sql, params = []) {
      const r = await db.execute(sql, params);
      return { lastInsertId: r.lastInsertId === undefined ? undefined : Number(r.lastInsertId) };
    },
    select: (sql, params = []) => db.select(sql, params),
  };
}

const LS_KEY = "fiszki-db";

/**
 * SQLite w pamięci przez sql.js (WebAssembly). Używane, gdy aplikacja działa w zwykłej
 * przeglądarce (npm run dev) oraz w testach. W przeglądarce stan zapisywany jest w localStorage.
 */
export async function sqlJsDriver(opts: { persist?: boolean; wasmUrl?: string } = {}): Promise<SqlDriver> {
  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs(opts.wasmUrl ? { locateFile: () => opts.wasmUrl! } : undefined);
  let saved: Uint8Array | undefined;
  if (opts.persist) {
    try {
      const b64 = localStorage.getItem(LS_KEY);
      if (b64) saved = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } catch {
      /* brak dostępu do localStorage */
    }
  }
  const db = new SQL.Database(saved);
  const persist = () => {
    if (!opts.persist) return;
    try {
      const bytes = db.export();
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(LS_KEY, btoa(bin));
    } catch {
      /* ignorujemy */
    }
  };
  return {
    async execute(sql, params = []) {
      db.run(sql, params as never);
      const [[id]] = db.exec("SELECT last_insert_rowid()")[0]?.values ?? [[undefined]];
      if (!/^\s*(SELECT|CREATE)/i.test(sql)) persist();
      return { lastInsertId: id === undefined ? undefined : Number(id) };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params as never);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      stmt.free();
      return out;
    },
  };
}
