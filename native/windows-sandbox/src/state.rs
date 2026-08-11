use crate::protocol::{SandboxError, SandboxErrorCode, SIDECAR_VERSION};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

pub const STATE_SCHEMA_VERSION: u32 = 1;
pub const OFFLINE_USERNAME: &str = "SetsunaSandboxOffline";
pub const ONLINE_USERNAME: &str = "SetsunaSandboxOnline";
pub const SANDBOX_GROUP: &str = "SetsunaSandboxUsers";
pub const PROXY_PORT_START: u16 = 61_080;
pub const PROXY_PORT_END: u16 = 61_089;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxAccountState {
    pub username: String,
    pub sid: String,
    pub encrypted_password: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityRecord {
    pub sid: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledState {
    pub schema_version: u32,
    pub installed_version: String,
    pub owner_sid: String,
    pub group_sid: String,
    pub offline: SandboxAccountState,
    pub online: SandboxAccountState,
    pub proxy_port_start: u16,
    pub proxy_port_end: u16,
    #[serde(default)]
    pub capabilities: BTreeMap<String, CapabilityRecord>,
}

impl InstalledState {
    pub fn validate(&self) -> Result<(), SandboxError> {
        if self.schema_version != STATE_SCHEMA_VERSION {
            return Err(SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                format!(
                    "installed schema version {} is not supported",
                    self.schema_version
                ),
            ));
        }
        if self.installed_version != SIDECAR_VERSION {
            return Err(SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                format!(
                    "installed sandbox version {} differs from sidecar version {SIDECAR_VERSION}",
                    self.installed_version
                ),
            ));
        }
        if self.offline.username != OFFLINE_USERNAME
            || self.online.username != ONLINE_USERNAME
            || self.proxy_port_start != PROXY_PORT_START
            || self.proxy_port_end != PROXY_PORT_END
        {
            return Err(SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                "installed sandbox identity or proxy range is invalid",
            ));
        }
        Ok(())
    }
}

pub struct StateStore {
    directory: PathBuf,
}

impl StateStore {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn state_path(&self) -> PathBuf {
        self.directory.join("state.json")
    }

    pub fn lock_path(&self) -> PathBuf {
        self.directory.join("state.lock")
    }

    pub fn read(&self) -> Result<Option<InstalledState>, SandboxError> {
        if !self.directory.exists() {
            return Ok(None);
        }
        let lock = self.open_lock(SandboxErrorCode::NeedsRepair)?;
        FileExt::lock_shared(&lock).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::NeedsRepair,
                "cannot lock sandbox state for reading",
                error,
            )
        })?;
        let path = self.state_path();
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let _ = FileExt::unlock(&lock);
                return Ok(None);
            }
            Err(error) => {
                let _ = FileExt::unlock(&lock);
                return Err(SandboxError::with_source(
                    SandboxErrorCode::NeedsRepair,
                    format!("cannot read sandbox state {}", path.display()),
                    error,
                ));
            }
        };
        let _ = FileExt::unlock(&lock);
        let state = serde_json::from_slice::<InstalledState>(&bytes).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::NeedsRepair,
                "sandbox state is corrupt",
                error,
            )
        })?;
        state.validate()?;
        Ok(Some(state))
    }

    pub fn update<T>(
        &self,
        operation: impl FnOnce(&mut InstalledState) -> Result<T, SandboxError>,
    ) -> Result<T, SandboxError> {
        fs::create_dir_all(&self.directory).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::Internal,
                format!(
                    "cannot create sandbox state directory {}",
                    self.directory.display()
                ),
                error,
            )
        })?;
        let lock = self.open_lock(SandboxErrorCode::Internal)?;
        lock.lock_exclusive().map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::Internal,
                "cannot lock sandbox state",
                error,
            )
        })?;
        let path = self.state_path();
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::Internal,
                    format!("cannot open sandbox state {}", path.display()),
                    error,
                )
            })?;
        let result = update_locked_state(&mut file, operation);
        let _ = FileExt::unlock(&lock);
        result
    }

    pub fn write_new(&self, state: &InstalledState) -> Result<(), SandboxError> {
        fs::create_dir_all(&self.directory).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SetupFailed,
                format!(
                    "cannot create sandbox state directory {}",
                    self.directory.display()
                ),
                error,
            )
        })?;
        let lock = self.open_lock(SandboxErrorCode::SetupFailed)?;
        lock.lock_exclusive().map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SetupFailed,
                "cannot lock sandbox state for installation",
                error,
            )
        })?;
        let path = self.state_path();
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
            .map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::SetupFailed,
                    format!("cannot create sandbox state {}", path.display()),
                    error,
                )
            })?;
        let bytes = serde_json::to_vec_pretty(state).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::Internal,
                "cannot serialize sandbox state",
                error,
            )
        })?;
        let result = file
            .write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::SetupFailed,
                    "cannot persist sandbox state",
                    error,
                )
            });
        let _ = FileExt::unlock(&lock);
        result
    }

    fn open_lock(&self, code: SandboxErrorCode) -> Result<File, SandboxError> {
        OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.lock_path())
            .map_err(|error| {
                SandboxError::with_source(code, "cannot open sandbox state lock", error)
            })
    }
}

fn update_locked_state<T>(
    file: &mut File,
    operation: impl FnOnce(&mut InstalledState) -> Result<T, SandboxError>,
) -> Result<T, SandboxError> {
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::NeedsRepair,
            "cannot read locked sandbox state",
            error,
        )
    })?;
    let mut state = serde_json::from_slice::<InstalledState>(&bytes).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::NeedsRepair,
            "sandbox state is corrupt",
            error,
        )
    })?;
    state.validate()?;
    let output = operation(&mut state)?;
    let updated = serde_json::to_vec_pretty(&state).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::Internal,
            "cannot serialize sandbox state",
            error,
        )
    })?;
    file.seek(SeekFrom::Start(0))
        .and_then(|_| file.set_len(0))
        .and_then(|()| file.write_all(&updated))
        .and_then(|()| file.sync_all())
        .map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::Internal,
                "cannot persist updated sandbox state",
                error,
            )
        })?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> InstalledState {
        InstalledState {
            schema_version: STATE_SCHEMA_VERSION,
            installed_version: SIDECAR_VERSION.to_string(),
            owner_sid: "S-1-5-21-1-2-3-4".to_string(),
            group_sid: "S-1-5-21-5-6-7-8".to_string(),
            offline: SandboxAccountState {
                username: OFFLINE_USERNAME.to_string(),
                sid: "S-1-5-21-9-10-11-12".to_string(),
                encrypted_password: "offline".to_string(),
            },
            online: SandboxAccountState {
                username: ONLINE_USERNAME.to_string(),
                sid: "S-1-5-21-13-14-15-16".to_string(),
                encrypted_password: "online".to_string(),
            },
            proxy_port_start: PROXY_PORT_START,
            proxy_port_end: PROXY_PORT_END,
            capabilities: BTreeMap::new(),
        }
    }

    #[test]
    fn round_trips_and_updates_state() {
        let directory = tempfile::tempdir().expect("tempdir");
        let store = StateStore::new(directory.path().to_path_buf());
        store.write_new(&state()).expect("write state");
        store
            .update(|state| {
                state.capabilities.insert(
                    "policy".to_string(),
                    CapabilityRecord {
                        sid: "S-1-5-21-17-18-19-20".to_string(),
                    },
                );
                Ok(())
            })
            .expect("update state");
        assert!(store
            .read()
            .expect("read state")
            .expect("installed")
            .capabilities
            .contains_key("policy"));
    }
}
