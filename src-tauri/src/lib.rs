/// Zapisuje plik tekstowy (eksport fiszek) pod ścieżką wybraną przez użytkownika w oknie „Zapisz jako”.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Nie udało się zapisać pliku: {e}"))
}

/// Strony czatów AI, które aplikacja może otworzyć w domyślnej przeglądarce (podpowiedź w imporcie CSV).
const EXTERNAL_URLS: &[&str] = &["https://chatgpt.com/", "https://claude.ai/new"];

/// Otwiera jeden z dozwolonych adresów w domyślnej przeglądarce systemu.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !EXTERNAL_URLS.contains(&url.as_str()) {
        return Err("Niedozwolony adres".into());
    }
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result.map(|_| ()).map_err(|e| format!("Nie udało się otworzyć przeglądarki: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // SQLite: plik fiszki.db w katalogu danych aplikacji użytkownika.
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Okno „Zapisz jako” przy eksporcie fiszek.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text_file, open_url]);

    // Automatyczne aktualizacje z GitHub Releases (tylko desktop).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .run(tauri::generate_context!())
        .expect("błąd podczas uruchamiania aplikacji");
}
