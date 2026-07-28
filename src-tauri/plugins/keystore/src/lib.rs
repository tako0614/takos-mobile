use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

mod commands;
#[cfg(not(mobile))]
mod desktop;
mod error;
#[cfg(mobile)]
mod mobile;
mod models;

pub use error::{Error, Result};
#[cfg(not(mobile))]
use desktop as platform;
#[cfg(mobile)]
use mobile as platform;
use platform::Keystore;

pub trait KeystoreExt<R: Runtime> {
    fn keystore(&self) -> &Keystore<R>;
}

impl<R: Runtime, T: Manager<R>> KeystoreExt<R> for T {
    fn keystore(&self) -> &Keystore<R> {
        self.state::<Keystore<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keystore")
        .invoke_handler(tauri::generate_handler![
            commands::remove,
            commands::retrieve,
            commands::store
        ])
        .setup(|app, api| {
            let keystore = platform::init(app, api)?;
            app.manage(keystore);
            Ok(())
        })
        .build()
}
