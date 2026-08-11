use super::acl;
use crate::protocol::{SandboxError, SandboxErrorCode};
use crate::state::{InstalledState, StateStore};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

pub fn install(
    store: &StateStore,
    owner_sid: &str,
    sandbox_group_sid: &str,
) -> Result<PathBuf, SandboxError> {
    let source = current_executable(SandboxErrorCode::SetupFailed)?;
    let directory = store.runner_directory();
    fs::create_dir_all(&directory).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            format!(
                "cannot create sandbox runner directory {}",
                directory.display()
            ),
            error,
        )
    })?;
    acl::protect_runner_path(&directory, owner_sid, sandbox_group_sid)?;

    let destination = store.runner_path();
    if same_file(&source, &destination) {
        acl::protect_runner_path(&destination, owner_sid, sandbox_group_sid)?;
        verify_paths(
            &source,
            &directory,
            &destination,
            owner_sid,
            sandbox_group_sid,
        )?;
        return Ok(destination);
    }

    let temporary = directory.join(format!(
        ".setsuna-sandbox-runner-installing-{}.exe",
        std::process::id()
    ));
    let result = (|| {
        if temporary.exists() {
            fs::remove_file(&temporary).map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::SetupFailed,
                    format!(
                        "cannot replace stale sandbox runner {}",
                        temporary.display()
                    ),
                    error,
                )
            })?;
        }
        fs::copy(&source, &temporary).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SetupFailed,
                format!(
                    "cannot copy sandbox runner from {} to {}",
                    source.display(),
                    temporary.display()
                ),
                error,
            )
        })?;
        OpenOptions::new()
            .write(true)
            .open(&temporary)
            .and_then(|file| file.sync_all())
            .map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::SetupFailed,
                    format!("cannot sync sandbox runner {}", temporary.display()),
                    error,
                )
            })?;
        acl::protect_runner_path(&temporary, owner_sid, sandbox_group_sid)?;
        if destination.exists() {
            fs::remove_file(&destination).map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::SetupFailed,
                    format!("cannot replace sandbox runner {}", destination.display()),
                    error,
                )
            })?;
        }
        fs::rename(&temporary, &destination).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SetupFailed,
                format!("cannot activate sandbox runner {}", destination.display()),
                error,
            )
        })?;
        acl::protect_runner_path(&destination, owner_sid, sandbox_group_sid)?;
        verify_paths(
            &source,
            &directory,
            &destination,
            owner_sid,
            sandbox_group_sid,
        )?;
        Ok(destination.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub fn verify(store: &StateStore, state: &InstalledState) -> Result<PathBuf, SandboxError> {
    let source = current_executable(SandboxErrorCode::NeedsRepair)?;
    let directory = store.runner_directory();
    let destination = store.runner_path();
    verify_paths(
        &source,
        &directory,
        &destination,
        &state.owner_sid,
        &state.group_sid,
    )?;
    Ok(destination)
}

pub fn uninstall(store: &StateStore) -> Result<(), SandboxError> {
    let directory = store.runner_directory();
    if !directory.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&directory).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            format!(
                "cannot remove sandbox runner directory {}",
                directory.display()
            ),
            error,
        )
    })
}

fn verify_paths(
    source: &Path,
    directory: &Path,
    destination: &Path,
    owner_sid: &str,
    sandbox_group_sid: &str,
) -> Result<(), SandboxError> {
    if !directory.is_dir() || !destination.is_file() {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            "protected Windows sandbox runner is missing",
        ));
    }
    if fs::symlink_metadata(directory)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(true)
        || fs::symlink_metadata(destination)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(true)
    {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            "protected Windows sandbox runner cannot be a symbolic link",
        ));
    }
    acl::verify_runner_path(directory, owner_sid, sandbox_group_sid)?;
    acl::verify_runner_path(destination, owner_sid, sandbox_group_sid)?;
    if file_digest(source, SandboxErrorCode::NeedsRepair)?
        != file_digest(destination, SandboxErrorCode::NeedsRepair)?
    {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            "protected Windows sandbox runner differs from the bundled sidecar",
        ));
    }
    Ok(())
}

fn current_executable(code: SandboxErrorCode) -> Result<PathBuf, SandboxError> {
    let path = std::env::current_exe().map_err(|error| {
        SandboxError::with_source(code, "cannot resolve sandbox sidecar executable", error)
    })?;
    if path.is_file() {
        Ok(path)
    } else {
        Err(SandboxError::new(
            code,
            format!("sandbox sidecar executable is missing: {}", path.display()),
        ))
    }
}

fn file_digest(path: &Path, code: SandboxErrorCode) -> Result<[u8; 32], SandboxError> {
    let mut file = File::open(path).map_err(|error| {
        SandboxError::with_source(
            code,
            format!("cannot read sandbox runner {}", path.display()),
            error,
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            SandboxError::with_source(
                code,
                format!("cannot hash sandbox runner {}", path.display()),
                error,
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}
