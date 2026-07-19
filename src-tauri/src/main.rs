// Prevents additional console window on Windows in release, DO NOT remove this attribute.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    markrust_lib::run()
}
