import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Konfiguracja zgodna z Tauri: stały port, brak czyszczenia ekranu.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // Dźwięki zawsze jako osobne pliki (nie data: w JS), żeby łatwo je podmieniać i nie puchł bundle.
  build: { target: "es2021", outDir: "dist", assetsInlineLimit: (file) => (/\.(mp3|ogg|wav)$/.test(file) ? false : undefined) },
});
