fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_settings",
            "check_server",
            "save_server",
            "connect_server",
            "remove_server",
            "set_default_server",
            "open_update_settings",
            "desktop_update_status",
            "desktop_check_updates",
            "desktop_install_update",
        ]),
    ))
    .expect("could not build CodyWork Desktop")
}
