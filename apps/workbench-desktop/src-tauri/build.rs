fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_settings",
            "check_server",
            "save_server",
            "connect_server",
            "remove_server",
            "set_default_server",
        ]),
    ))
    .expect("could not build CodyWork Desktop")
}
