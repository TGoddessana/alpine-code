fn main() {
  // tauri_build embeds the app icon at compile time but only reruns when
  // tauri.conf.json changes, so a new icon set would keep the old one.
  println!("cargo:rerun-if-changed=icons");
  tauri_build::build()
}
