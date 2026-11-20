# Fiszki – lokalna aplikacja do nauki

Desktopowa aplikacja do samodzielnej nauki z fiszkami. Wszystkie dane zostają na Twoim komputerze (plik SQLite).

## Funkcje

- **Import fiszek z CSV** w formacie `pytanie,odpowiedź` (opcjonalnie trzecia kolumna z tagami: `biologia|komórka`).
  Separator (przecinek, średnik, tabulator) jest wykrywany automatycznie, działają cudzysłowy i pola wieloliniowe,
  nagłówek jest pomijany, duplikaty pytań są pomijane. Podgląd przed importem i możliwość dodania tagów do całego pliku.
- **Samoocena 1–5 gwiazdek** po odsłonięciu odpowiedzi (klawisze: `Spacja` – pokaż odpowiedź, `1`–`5` – ocena).
  Przy każdej gwiazdce widać, kiedy fiszka wróci.
- **Algorytm powtórek** (wariant SM-2) wyznacza dzień kolejnego pokazu – szczegóły niżej.
- **Streak** – seria dni z rzędu z co najmniej jedną powtórką, rekord, ostrzeżenie gdy dziś jeszcze nie było nauki,
  kalendarz aktywności z ostatnich 18 tygodni.
- **Tagi/kategorie** – filtrowanie nauki i listy fiszek po tagach, edycja tagów na fiszce.
- Prognoza liczby powtórek na najbliższe 7 dni, wyszukiwarka, dodawanie/edycja/usuwanie fiszek.
- **Zaznaczanie wielu fiszek** – „Zaznacz wszystkie” (w obrębie bieżącego filtra), usuwanie i **usypianie** zaznaczonych.
  Uśpione fiszki nie pojawiają się w żadnej sesji nauki; można je obudzić (filtr „Uśpione”).
- **Nauka bez oceny** – w zakładce Nauka: wybór tagów (domyślnie „Wszystko”), przeglądanie fiszek bez gwiazdek,
  bez wpływu na terminy powtórek, serię i statystyki.
- **Średnia ocen** na ekranie głównym: z dziś i z ostatnich 7 dni.
- **Motyw jasny / ciemny / systemowy** – przełącznik na dole paska bocznego, wybór jest zapamiętywany.

## Jak działa algorytm powtórek

Każda fiszka ma: liczbę udanych powtórek z rzędu, odstęp (dni) i współczynnik łatwości (start 2,5, minimum 1,3).

| Ocena | Znaczenie | Co się dzieje |
|---|---|---|
| 1★ | Nie pamiętam | powrót **jutro**, nauka od nowa, łatwość spada mocno |
| 2★ | Ledwo / fragment | powrót **jutro**, nauka od nowa, łatwość spada |
| 3★ | Z trudem | zaliczone, odstęp rośnie wolno, łatwość lekko spada |
| 4★ | Dobrze | zaliczone, odstęp × łatwość |
| 5★ | Perfekcyjnie | zaliczone, odstęp × łatwość, łatwość rośnie |

Pierwsza udana powtórka: 1 / 2 / 3 dni (dla 3/4/5★), druga: 3 / 6 / 6 dni, kolejne: poprzedni odstęp × łatwość.
Przykład: same piątki dają odstępy 3 → 6 → 17 → 49 → 147 dni. Logika jest w `src/lib/scheduler.ts`.

## Uruchomienie

### Wymagania (jednorazowo)

1. **Node.js 20+** – https://nodejs.org
2. **Rust** – https://rustup.rs
3. Zależności systemowe Tauri – https://v2.tauri.app/start/prerequisites/
   - **Windows:** Microsoft C++ Build Tools (WebView2 jest już w Windows 10/11)
   - **macOS:** `xcode-select --install`
   - **Linux (Debian/Ubuntu):** `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`

### Start

```bash
npm install
npm run tauri dev      # uruchamia aplikację desktopową (pierwsza kompilacja Rusta trwa kilka minut)
```

Gotowy instalator (`.msi`/`.exe`, `.dmg`, `.deb`/`.AppImage`):

```bash
npm run tauri build    # wynik w src-tauri/target/release/bundle/
```

### Instalator Windows (.exe) zbudowany z Linuksa

Bez Windowsa i Visual Studio, przez MinGW:

```bash
sudo apt install nsis mingw-w64
rustup target add x86_64-pc-windows-gnu
npm run tauri build -- --target x86_64-pc-windows-gnu --bundles nsis
# wynik: src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/Fiszki_0.2.0_x64-setup.exe
```

Na samym Windowsie wystarczy `npm run tauri build`.

Szybki podgląd samego interfejsu w przeglądarce (bez Rusta, dane w localStorage):

```bash
npm run dev            # http://localhost:1420
```

Testy logiki (algorytm, CSV, streak, baza):

```bash
npm test
```

### Gdzie są moje dane?

Plik `fiszki.db` w katalogu danych aplikacji `pl.fiszki.nauka`:
- Windows: `%APPDATA%\pl.fiszki.nauka\`
- macOS: `~/Library/Application Support/pl.fiszki.nauka/`
- Linux: `~/.config/pl.fiszki.nauka/`

Kopia zapasowa = skopiowanie tego pliku.

## Automatyczne aktualizacje

Od wersji 0.3.0 aplikacja przy każdym uruchomieniu sprawdza, czy na GitHub Releases
(`K1ktor/nauka-fiszki`) jest nowsza wersja. Jeśli tak, na górze pojawia się pasek „Zaktualizuj”:
aplikacja sama pobiera nową wersję, instaluje ją i uruchamia się ponownie. Bez internetu nic się nie dzieje.

Paczki są podpisane kluczem: aplikacja ma w `tauri.conf.json` klucz publiczny, a klucz prywatny jest
tylko w sekrecie repozytorium `TAURI_SIGNING_PRIVATE_KEY`. **Nie zgub klucza prywatnego** – bez niego
zainstalowane aplikacje nie przyjmą kolejnych aktualizacji.

### Jak wydać nową wersję

1. Podnieś numer wersji w `package.json`, `src-tauri/tauri.conf.json` i `src-tauri/Cargo.toml` (np. 0.3.0 → 0.4.0).
2. Zatwierdź zmiany i wypchnij je na gałąź `wydanie`:
   ```bash
   git commit -am "Wersja 0.4.0"
   git push && git push origin main:wydanie
   ```
   (Zamiast tego można też wypchnąć tag: `git tag v0.4.0 && git push origin v0.4.0`.)
3. GitHub Actions (`.github/workflows/release.yml`) zbuduje instalator Windows, podpisze go
   i opublikuje wydanie z plikiem `latest.json`. Trwa to ok. 10–15 minut.

Repozytorium musi być publiczne – z prywatnego aplikacja nie pobierze aktualizacji.

## Przykładowy plik

`przyklady/przyklad-fiszki.csv` – 10 fiszek do przetestowania importu.

## Struktura

```
src/
  lib/scheduler.ts   algorytm powtórek (SM-2 na 1–5 gwiazdek)
  lib/csv.ts         parser CSV
  lib/streak.ts      liczenie serii dni
  lib/db.ts          schemat SQLite i operacje na danych
  lib/drivers.ts     SQLite przez Tauri (desktop) lub sql.js (przeglądarka/testy)
  components/        Dashboard, Study (nauka), CardList (fiszki), ImportView
src-tauri/           powłoka desktopowa Tauri 2 (Rust) z pluginem SQL
```
