import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Konfiguracja zgodna z Tauri: stały port, brak czyszczenia ekranu.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: "es2021", outDir: "dist" },
});
