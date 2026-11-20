/// Zapisuje plik tekstowy (eksport fiszek) pod ścieżką wybraną przez użytkownika w oknie „Zapisz jako”.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Nie udało się zapisać pliku: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // SQLite: plik fiszki.db w katalogu danych aplikacji użytkownika.
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Okno „Zapisz jako” przy eksporcie fiszek.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text_file]);

    // Automatyczne aktualizacje z GitHub Releases (tylko desktop).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .run(tauri::generate_context!())
        .expect("błąd podczas uruchamiania aplikacji");
}
