// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `cyberfrog --mcp` serves AI assistants over stdio instead of opening the window
    if std::env::args().any(|a| a == "--mcp") {
        cyberfrog_lib::mcp::run();
    } else {
        cyberfrog_lib::run();
    }
}
