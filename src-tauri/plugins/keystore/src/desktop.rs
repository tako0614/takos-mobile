use std::marker::PhantomData;

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::{RemoveRequest, RetrieveRequest, RetrieveResponse, StoreRequest};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Keystore<R>> {
    Ok(Keystore(PhantomData))
}

// This state does not own or access the runtime value. Using a function-pointer
// marker keeps the zero-sized handle Send + Sync without imposing additional
// bounds on Tauri's Runtime parameter.
pub struct Keystore<R: Runtime>(PhantomData<fn() -> R>);

impl<R: Runtime> Keystore<R> {
    pub fn store(&self, payload: StoreRequest) -> crate::Result<()> {
        entry(&payload.service, &payload.user)?.set_password(&payload.value)?;
        Ok(())
    }

    pub fn retrieve(&self, payload: RetrieveRequest) -> crate::Result<RetrieveResponse> {
        let value = match entry(&payload.service, &payload.user)?.get_password() {
            Ok(value) => Some(value),
            Err(keyring::Error::NoEntry) => None,
            Err(error) => return Err(error.into()),
        };
        Ok(RetrieveResponse { value })
    }

    pub fn remove(&self, payload: RemoveRequest) -> crate::Result<()> {
        match entry(&payload.service, &payload.user)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

fn entry(service: &str, user: &str) -> crate::Result<keyring::Entry> {
    if service.trim().is_empty() || user.trim().is_empty() {
        return Err(crate::Error::InvalidIdentity);
    }
    Ok(keyring::Entry::new(service, user)?)
}
