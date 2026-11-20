// Ukrywa dodatkowe okno konsoli w Windows w wersji release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fiszki_lib::run()
}
