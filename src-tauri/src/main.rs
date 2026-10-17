// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `cyberfrog --mcp` serves AI assistants over stdio instead of opening the window
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--mcp") {
        cyberfrog_lib::mcp::run();
    } else if let Some(i) = args.iter().position(|a| a == "--scheduled") {
        // launchd runs a scheduled crawl this way, with no window
        cyberfrog_lib::schedule::run(args.get(i + 1).map_or("", String::as_str));
    } else {
        cyberfrog_lib::run();
    }
}
