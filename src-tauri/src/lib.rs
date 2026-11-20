#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // SQLite: plik fiszki.db w katalogu danych aplikacji użytkownika.
        .plugin(tauri_plugin_sql::Builder::default().build());

    // Automatyczne aktualizacje z GitHub Releases (tylko desktop).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .run(tauri::generate_context!())
        .expect("błąd podczas uruchamiania aplikacji");
}
