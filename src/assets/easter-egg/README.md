# Grafika i dźwięki easter egga

Wszystkie pliki postaci z ekranu „Dziś” leżą w tym folderze. Żeby je podmienić, wrzuć własne pliki
pod tymi samymi nazwami i zbuduj aplikację (`npm run tauri build` albo wydanie przez GitHub Actions).

| Plik | Kiedy | Formaty |
|---|---|---|
| `postac.png` | obrazek postaci (przezroczyste tło, zwrócona w prawo) | `.png`, `.webp`, `.gif`, `.svg`, `.jpg` |
| `ult.mp3` | okrzyk/wybuch, gdy postać wyskakuje zza rogu | `.mp3`, `.ogg`, `.wav` |
| `chwyt.mp3` | rzut liny i zaznaczenie okienek zielonymi kółkami | `.mp3`, `.ogg`, `.wav` |
| `przyciaganie.mp3` | przyciąganie okienek do postaci | `.mp3`, `.ogg`, `.wav` |
| `uderzenie.mp3` | ciśnięcie o podłogę (głośno) i każdy cios (ciszej) | `.mp3`, `.ogg`, `.wav` |

Bez `postac.*` rysuje się wbudowana postać SVG (`src/components/EasterEgg.tsx`). Brakujący dźwięk jest po prostu pomijany.
Jeśli w folderze jest kilka formatów tego samego pliku, wygrywa pierwszy alfabetycznie (`.mp3` przed `.ogg` i `.wav`),
więc przy podmianie usuń stary plik.

Dołączone dźwięki są wygenerowane syntetycznie specjalnie dla tej aplikacji.
