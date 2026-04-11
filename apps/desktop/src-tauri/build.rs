fn main() {
    // Ensure the sidecar placeholder exists so tauri_build::build() doesn't
    // fail during `cargo test` or `cargo check` in CI where the real Pi
    // sidecar binary hasn't been compiled yet.
    let target = std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| std::env::var("TARGET"))
        .unwrap_or_default();
    if !target.is_empty() {
        let ext = if target.contains("windows") { ".exe" } else { "" };
        let sidecar = format!("binaries/pi-sidecar-{}{}", target, ext);
        let path = std::path::PathBuf::from(
            std::env::var("CARGO_MANIFEST_DIR").unwrap(),
        )
        .join(&sidecar);
        if !path.exists() {
            let _ = std::fs::create_dir_all(path.parent().unwrap());
            let _ = std::fs::write(&path, "placeholder");
            println!("cargo:warning=Created sidecar placeholder: {}", sidecar);
        }
    }

    tauri_build::build()
}
