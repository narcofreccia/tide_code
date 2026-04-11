fn main() {
    // Ensure placeholders exist so tauri_build::build() doesn't fail during
    // `cargo test` / `cargo check` in CI where the real Pi sidecar binary
    // and bundled pi-assets haven't been produced yet. Both paths are
    // gitignored so fresh checkouts lack them.
    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").unwrap(),
    );

    let target = std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| std::env::var("TARGET"))
        .unwrap_or_default();
    if !target.is_empty() {
        let ext = if target.contains("windows") { ".exe" } else { "" };
        let sidecar = format!("binaries/pi-sidecar-{}{}", target, ext);
        let path = manifest_dir.join(&sidecar);
        if !path.exists() {
            let _ = std::fs::create_dir_all(path.parent().unwrap());
            let _ = std::fs::write(&path, "placeholder");
            println!("cargo:warning=Created sidecar placeholder: {}", sidecar);
        }
    }

    // tauri.conf.json bundles `resources/pi-assets/**/*`. The glob fails if
    // the directory has no files, so drop a .gitkeep if needed.
    let pi_assets = manifest_dir.join("resources/pi-assets");
    let keep = pi_assets.join(".gitkeep");
    if !pi_assets.exists() || std::fs::read_dir(&pi_assets).map(|mut d| d.next().is_none()).unwrap_or(true) {
        let _ = std::fs::create_dir_all(&pi_assets);
        let _ = std::fs::write(&keep, "");
        println!("cargo:warning=Created pi-assets placeholder: resources/pi-assets/.gitkeep");
    }

    tauri_build::build()
}
