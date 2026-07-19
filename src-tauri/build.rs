fn main() {
    // Guard: warn when building in release mode without the `embed-frontend` feature.
    //
    // tauri crate's build.rs sets `cargo:dev = !has_feature("custom-protocol")`.
    // Without `tauri/custom-protocol`, `dev` cfg is set, and `generate_context!`
    // generates code that loads frontend from devUrl (localhost:1420) instead of
    // embedding frontendDist assets. This makes the release exe unusable without
    // a running dev server.
    //
    // Fix: `cargo build --release --features embed-frontend`
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let has_embed_feature = std::env::var("CARGO_FEATURE_EMBED_FRONTEND").is_ok();
    if profile == "release" && !has_embed_feature {
        println!("cargo:warning=");
        println!("cargo:warning=========================================================");
        println!("cargo:warning= WARNING: Building in release mode WITHOUT 'embed-frontend'");
        println!("cargo:warning= The exe will load from devUrl (localhost:1420) instead of");
        println!("cargo:warning= embedded frontend assets and will NOT work standalone.");
        println!("cargo:warning=");
        println!("cargo:warning= Fix: cargo build --release --features embed-frontend");
        println!("cargo:warning=      npx tauri build --no-bundle");
        println!("cargo:warning=========================================================");
        println!("cargo:warning=");
    }

    tauri_build::build()
}
